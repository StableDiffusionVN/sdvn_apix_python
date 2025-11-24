import os
import base64
import uuid
import glob
import json
import shutil
from datetime import datetime
from io import BytesIO
from send2trash import send2trash
from flask import Flask, render_template, request, jsonify, url_for
from google import genai
from google.genai import types
from PIL import Image, PngImagePlugin

import logging

app = Flask(__name__)
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

PREVIEW_MAX_DIMENSION = 1024
PREVIEW_JPEG_QUALITY = 85

try:
    RESAMPLE_FILTER = Image.Resampling.LANCZOS
except AttributeError:
    if hasattr(Image, 'LANCZOS'):
        RESAMPLE_FILTER = Image.LANCZOS
    else:
        RESAMPLE_FILTER = Image.BICUBIC

FORMAT_BY_EXTENSION = {
    '.jpg': 'JPEG',
    '.jpeg': 'JPEG',
    '.png': 'PNG',
    '.webp': 'WEBP',
}


def _normalize_extension(ext):
    if not ext:
        return '.png'
    ext = ext.lower()
    if not ext.startswith('.'):
        ext = f'.{ext}'
    return ext


def _format_for_extension(ext):
    return FORMAT_BY_EXTENSION.get(ext, 'PNG')


def save_compressed_preview(image, filepath, extension):
    extension = _normalize_extension(extension)
    image_copy = image.copy()
    image_copy.thumbnail((PREVIEW_MAX_DIMENSION, PREVIEW_MAX_DIMENSION), RESAMPLE_FILTER)
    image_format = _format_for_extension(extension)
    save_kwargs = {}

    if image_format == 'JPEG':
        if image_copy.mode not in ('RGB', 'RGBA'):
            image_copy = image_copy.convert('RGB')
        save_kwargs.update(quality=PREVIEW_JPEG_QUALITY, optimize=True, progressive=True)
    elif image_format == 'WEBP':
        save_kwargs.update(quality=PREVIEW_JPEG_QUALITY, method=6)
    elif image_format == 'PNG':
        save_kwargs.update(optimize=True)

    image_copy.save(filepath, format=image_format, **save_kwargs)


def save_preview_image(preview_dir, extension='.png', source_bytes=None, source_path=None):
    extension = _normalize_extension(extension)
    filename = f"template_{uuid.uuid4()}{extension}"
    filepath = os.path.join(preview_dir, filename)

    try:
        image = None
        if source_bytes is not None:
            image = Image.open(BytesIO(source_bytes))
        elif source_path is not None:
            image = Image.open(source_path)

        if image is not None:
            save_compressed_preview(image, filepath, extension)
            return filename
        elif source_bytes is not None:
            with open(filepath, 'wb') as f:
                f.write(source_bytes)
            return filename
        elif source_path is not None:
            shutil.copy2(source_path, filepath)
            return filename
    except Exception as exc:
        print(f"Error saving preview image '{filename}': {exc}")
        try:
            if source_bytes is not None:
                with open(filepath, 'wb') as f:
                    f.write(source_bytes)
                return filename
            if source_path is not None:
                shutil.copy2(source_path, filepath)
                return filename
        except Exception as fallback_exc:
            print(f"Fallback saving preview image failed: {fallback_exc}")
        return None

    return None

FAVORITES_FILE = os.path.join(os.path.dirname(__file__), 'template_favorites.json')

def load_template_favorites():
    if os.path.exists(FAVORITES_FILE):
        try:
            with open(FAVORITES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    return [item for item in data if isinstance(item, str)]
        except json.JSONDecodeError:
            pass
    return []

def save_template_favorites(favorites):
    try:
        with open(FAVORITES_FILE, 'w', encoding='utf-8') as f:
            json.dump(favorites, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"Failed to persist template favorites: {e}")

def parse_tags_field(value):
    tags = []
    if isinstance(value, list):
        tags = value
    elif isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                tags = parsed
            else:
                tags = [parsed]
        except json.JSONDecodeError:
            tags = [value]
    else:
        return []

    result = []
    for tag in tags:
        if isinstance(tag, dict):
            fallback = tag.get('vi') or tag.get('en')
            if fallback:
                normalized = fallback.strip()
            else:
                continue
        elif isinstance(tag, str):
            normalized = tag.strip()
        else:
            continue

        if normalized:
            result.append(normalized)
            if len(result) >= 12:
                break

    return result

# Ensure generated directory exists inside Flask static folder
GENERATED_DIR = os.path.join(app.static_folder, 'generated')
os.makedirs(GENERATED_DIR, exist_ok=True)

# Ensure uploads directory exists
UPLOADS_DIR = os.path.join(app.static_folder, 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/generate', methods=['POST'])
def generate_image():
    multipart = request.content_type and 'multipart/form-data' in request.content_type

    if multipart:
        form = request.form
        prompt = form.get('prompt')
        aspect_ratio = form.get('aspect_ratio')
        resolution = form.get('resolution', '2K')
        api_key = form.get('api_key') or os.environ.get('GOOGLE_API_KEY')
        reference_files = request.files.getlist('reference_images')
        reference_paths_json = form.get('reference_image_paths')
    else:
        data = request.get_json() or {}
        prompt = data.get('prompt')
        aspect_ratio = data.get('aspect_ratio')
        resolution = data.get('resolution', '2K')
        api_key = data.get('api_key') or os.environ.get('GOOGLE_API_KEY')
        reference_files = []
        reference_paths_json = data.get('reference_image_paths')

    if not prompt:
        return jsonify({'error': 'Prompt is required'}), 400
    
    if not api_key:
        return jsonify({'error': 'API Key is required.'}), 401

    try:
        print("Đang gửi lệnh...", flush=True)
        client = genai.Client(api_key=api_key)

        image_config_args = {
            "image_size": resolution
        }

        if aspect_ratio and aspect_ratio != 'Auto':
            image_config_args["aspect_ratio"] = aspect_ratio

        # Process reference paths and files
        final_reference_paths = []
        contents = [prompt]
        
        # Parse reference paths from frontend
        frontend_paths = []
        if reference_paths_json:
            try:
                frontend_paths = json.loads(reference_paths_json)
            except json.JSONDecodeError:
                pass
        
        # If no paths provided but we have files (legacy or simple upload), treat all as new uploads
        # But we need to handle the mix.
        # Strategy: Iterate frontend_paths. If it looks like a path/URL, keep it.
        # If it doesn't (or is null), consume from reference_files.
        
        file_index = 0
        
        # If frontend_paths is empty but we have files, just use the files
        if not frontend_paths and reference_files:
             for _ in reference_files:
                 frontend_paths.append(None) # Placeholder for each file

        for path in frontend_paths:
            if path and (path.startswith('/') or path.startswith('http')):
                # Existing path/URL
                final_reference_paths.append(path)
                # We also need to add the image content to the prompt
                # We need to fetch it or read it if it's local (server-side local)
                # If it's a URL we generated, it's in static/generated or static/uploads
                # path might be "http://localhost:8888/static/generated/..." or "/static/generated/..."
                
                # Extract relative path to open file
                # Assuming path contains '/static/'
                try:
                    if '/static/' in path:
                        rel_path = path.split('/static/')[1]
                        abs_path = os.path.join(app.static_folder, rel_path)
                        if os.path.exists(abs_path):
                            img = Image.open(abs_path)
                            contents.append(img)
                        else:
                            print(f"Warning: Reference file not found at {abs_path}")
                    else:
                         print(f"Warning: Could not resolve local path for {path}")
                except Exception as e:
                    print(f"Error loading reference from path {path}: {e}")

            elif file_index < len(reference_files):
                # New upload
                file = reference_files[file_index]
                file_index += 1
                
                try:
                    # Save to uploads
                    ext = os.path.splitext(file.filename)[1]
                    if not ext:
                        ext = '.png'
                    filename = f"{uuid.uuid4()}{ext}"
                    filepath = os.path.join(UPLOADS_DIR, filename)
                    
                    # We need to read the file for Gemini AND save it
                    # file.stream is a stream.
                    file.stream.seek(0)
                    file_bytes = file.read()
                    
                    with open(filepath, 'wb') as f:
                        f.write(file_bytes)
                        
                    # Add to contents
                    image = Image.open(BytesIO(file_bytes))
                    contents.append(image)
                    
                    # Add to final paths
                    # URL for the uploaded file
                    rel_path = os.path.join('uploads', filename)
                    file_url = url_for('static', filename=rel_path)
                    final_reference_paths.append(file_url)
                    
                except Exception as e:
                    print(f"Error processing uploaded file: {e}")
                    continue

        model_name = "gemini-3-pro-image-preview"
        print("Đang tạo...", flush=True)
        response = client.models.generate_content(
            model=model_name,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=['IMAGE'],
                image_config=types.ImageConfig(**image_config_args),
            )
        )
        print("Hoàn tất!", flush=True)

        for part in response.parts:
            if part.inline_data:
                image_bytes = part.inline_data.data

                image = Image.open(BytesIO(image_bytes))
                png_info = PngImagePlugin.PngInfo()

                date_str = datetime.now().strftime("%Y%m%d")
                
                # Find existing files to determine next ID
                search_pattern = os.path.join(GENERATED_DIR, f"{model_name}_{date_str}_*.png")
                existing_files = glob.glob(search_pattern)
                max_id = 0
                for f in existing_files:
                    try:
                        basename = os.path.basename(f)
                        name_without_ext = os.path.splitext(basename)[0]
                        id_part = name_without_ext.split('_')[-1]
                        id_num = int(id_part)
                        if id_num > max_id:
                            max_id = id_num
                    except ValueError:
                        continue
                
                next_id = max_id + 1
                filename = f"{model_name}_{date_str}_{next_id}.png"
                filepath = os.path.join(GENERATED_DIR, filename)
                rel_path = os.path.join('generated', filename)
                image_url = url_for('static', filename=rel_path)

                metadata = {
                    'prompt': prompt,
                    'aspect_ratio': aspect_ratio or 'Auto',
                    'resolution': resolution,
                    'reference_images': final_reference_paths,
                }

                png_info.add_text('sdvn_meta', json.dumps(metadata))

                buffer = BytesIO()
                image.save(buffer, format='PNG', pnginfo=png_info)
                final_bytes = buffer.getvalue()

                # Save image to file
                with open(filepath, 'wb') as f:
                    f.write(final_bytes)

                image_data = base64.b64encode(final_bytes).decode('utf-8')
                return jsonify({
                    'image': image_url,
                    'image_data': image_data,
                    'metadata': metadata,
                })
        
        return jsonify({'error': 'No image generated'}), 500

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/delete_image', methods=['POST'])
def delete_image():
    data = request.get_json()
    filename = data.get('filename')
    
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
        
    # Security check: ensure filename is just a basename, no paths
    filename = os.path.basename(filename)
    filepath = os.path.join(GENERATED_DIR, filename)
    
    if os.path.exists(filepath):
        try:
            send2trash(filepath)
            return jsonify({'success': True})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    else:
        return jsonify({'error': 'File not found'}), 404

@app.route('/gallery')
def get_gallery():
    # List all png files in generated dir, sorted by modification time (newest first)
    files = glob.glob(os.path.join(GENERATED_DIR, '*.png'))
    files.sort(key=os.path.getmtime, reverse=True)
    
    image_urls = [url_for('static', filename=f'generated/{os.path.basename(f)}') for f in files]
    response = jsonify({'images': image_urls})
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response

@app.route('/prompts')
def get_prompts():
    category = request.args.get('category')
    
    try:
        all_prompts = []
        
        # Read prompts.json file
        prompts_path = os.path.join(os.path.dirname(__file__), 'prompts.json')
        if os.path.exists(prompts_path):
            with open(prompts_path, 'r', encoding='utf-8') as f:
                try:
                    builtin_prompts = json.load(f)
                    if isinstance(builtin_prompts, list):
                        for idx, prompt in enumerate(builtin_prompts):
                            prompt['builtinTemplateIndex'] = idx
                            prompt['tags'] = parse_tags_field(prompt.get('tags'))
                        all_prompts.extend(builtin_prompts)
                except json.JSONDecodeError:
                    pass
            
        # Read user_prompts.json file and mark as user templates
        user_prompts_path = os.path.join(os.path.dirname(__file__), 'user_prompts.json')
        if os.path.exists(user_prompts_path):
            try:
                with open(user_prompts_path, 'r', encoding='utf-8') as f:
                    user_prompts = json.load(f)
                    if isinstance(user_prompts, list):
                        # Mark each user template and add index for editing
                        for idx, template in enumerate(user_prompts):
                            template['isUserTemplate'] = True
                            template['userTemplateIndex'] = idx
                            template['tags'] = parse_tags_field(template.get('tags'))
                        all_prompts.extend(user_prompts)
            except json.JSONDecodeError:
                pass # Ignore if empty or invalid
        
        # Filter by category if specified
        if category:
            all_prompts = [p for p in all_prompts if p.get('category') == category]
        
        favorites = load_template_favorites()
        response = jsonify({'prompts': all_prompts, 'favorites': favorites})
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/template_favorite', methods=['POST'])
def template_favorite():
    data = request.get_json() or {}
    key = data.get('key')
    favorite = data.get('favorite')

    if not key or not isinstance(favorite, bool):
        return jsonify({'error': 'Invalid favorite payload'}), 400

    favorites = load_template_favorites()

    if favorite:
        if key not in favorites:
            favorites.append(key)
    else:
        favorites = [item for item in favorites if item != key]

    save_template_favorites(favorites)
    return jsonify({'favorites': favorites})

@app.route('/save_template', methods=['POST'])
def save_template():
    try:
        import requests
        from urllib.parse import urlparse
        
        # Handle multipart form data
        title = request.form.get('title')
        prompt = request.form.get('prompt')
        mode = request.form.get('mode', 'generate')
        category = request.form.get('category', 'User')
        tags_field = request.form.get('tags')
        tags = parse_tags_field(tags_field)
        
        if not title or not prompt:
            return jsonify({'error': 'Title and prompt are required'}), 400
            
        # Handle preview image
        preview_path = None
        preview_dir = os.path.join(app.static_folder, 'preview')
        os.makedirs(preview_dir, exist_ok=True)
        
        # Check if file was uploaded
        if 'preview' in request.files:
            file = request.files['preview']
            if file.filename:
                ext = os.path.splitext(file.filename)[1] or '.png'
                file.stream.seek(0)
                file_bytes = file.read()
                preview_filename = save_preview_image(
                    preview_dir=preview_dir,
                    extension=ext,
                    source_bytes=file_bytes
                )

                if preview_filename:
                    preview_path = url_for('static', filename=f'preview/{preview_filename}')
        
        # If no file uploaded, check if URL/path provided
        if not preview_path:
            preview_url = request.form.get('preview_path')
            if preview_url:
                try:
                    # Check if it's a URL or local path
                    if preview_url.startswith('http://') or preview_url.startswith('https://'):
                        # Download from URL
                        response = requests.get(preview_url, timeout=10)
                        response.raise_for_status()
                        
                        # Determine extension from content-type or URL
                        content_type = response.headers.get('content-type', '')
                        if 'image/png' in content_type:
                            ext = '.png'
                        elif 'image/jpeg' in content_type or 'image/jpg' in content_type:
                            ext = '.jpg'
                        elif 'image/webp' in content_type:
                            ext = '.webp'
                        else:
                            # Try to get from URL
                            parsed = urlparse(preview_url)
                            ext = os.path.splitext(parsed.path)[1] or '.png'
                        
                        preview_filename = save_preview_image(
                            preview_dir=preview_dir,
                            extension=ext,
                            source_bytes=response.content
                        )

                        if preview_filename:
                            preview_path = url_for('static', filename=f'preview/{preview_filename}')
                        else:
                            preview_path = preview_url
                    
                    elif preview_url.startswith('/static/'):
                        # Local path - copy to preview folder
                        rel_path = preview_url.split('/static/')[1]
                        source_path = os.path.join(app.static_folder, rel_path)
                        
                        if os.path.exists(source_path):
                            ext = os.path.splitext(source_path)[1] or '.png'
                            preview_filename = save_preview_image(
                                preview_dir=preview_dir,
                                extension=ext,
                                source_path=source_path
                            )

                            if preview_filename:
                                preview_path = url_for('static', filename=f'preview/{preview_filename}')
                            else:
                                preview_path = preview_url
                        else:
                            # File doesn't exist, use original path
                            preview_path = preview_url
                    else:
                        # Use as-is if it's already a valid path
                        preview_path = preview_url
                        
                except Exception as e:
                    print(f"Error processing preview image URL: {e}")
                    # Use the original URL if processing fails
                    preview_path = preview_url
            
        new_template = {
            'title': title,
            'prompt': prompt,
            'mode': mode,
            'category': category,
            'preview': preview_path,
            'tags': tags
        }
        
        # Save to user_prompts.json
        user_prompts_path = os.path.join(os.path.dirname(__file__), 'user_prompts.json')
        user_prompts = []
        
        if os.path.exists(user_prompts_path):
            try:
                with open(user_prompts_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if content.strip():
                        user_prompts = json.loads(content)
            except json.JSONDecodeError:
                pass
                
        user_prompts.append(new_template)
        
        with open(user_prompts_path, 'w', encoding='utf-8') as f:
            json.dump(user_prompts, f, indent=4, ensure_ascii=False)
            
        return jsonify({'success': True, 'template': new_template})
        
    except Exception as e:
        print(f"Error saving template: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/update_template', methods=['POST'])
def update_template():
    try:
        import requests
        from urllib.parse import urlparse

        template_index = request.form.get('template_index')
        builtin_index_raw = request.form.get('builtin_index')
        builtin_index = None

        try:
            if builtin_index_raw:
                builtin_index = int(builtin_index_raw)
        except ValueError:
            return jsonify({'error': 'Invalid builtin template index'}), 400

        if template_index is None and builtin_index is None:
            return jsonify({'error': 'Template index or builtin index is required'}), 400

        if template_index is not None:
            try:
                template_index = int(template_index)
            except ValueError:
                return jsonify({'error': 'Invalid template index'}), 400

        title = request.form.get('title')
        prompt = request.form.get('prompt')
        mode = request.form.get('mode', 'generate')
        category = request.form.get('category', 'User')
        tags_field = request.form.get('tags')
        tags = parse_tags_field(tags_field)

        if not title or not prompt:
            return jsonify({'error': 'Title and prompt are required'}), 400

        preview_path = None
        preview_dir = os.path.join(app.static_folder, 'preview')
        os.makedirs(preview_dir, exist_ok=True)

        if 'preview' in request.files:
            file = request.files['preview']
            if file.filename:
                ext = os.path.splitext(file.filename)[1] or '.png'
                file.stream.seek(0)
                file_bytes = file.read()
                preview_filename = save_preview_image(
                    preview_dir=preview_dir,
                    extension=ext,
                    source_bytes=file_bytes
                )

                if preview_filename:
                    preview_path = url_for('static', filename=f'preview/{preview_filename}')

        if not preview_path:
            preview_url = request.form.get('preview_path')
            if preview_url:
                try:
                    if preview_url.startswith('http://') or preview_url.startswith('https://'):
                        response = requests.get(preview_url, timeout=10)
                        response.raise_for_status()

                        content_type = response.headers.get('content-type', '')
                        if 'image/png' in content_type:
                            ext = '.png'
                        elif 'image/jpeg' in content_type or 'image/jpg' in content_type:
                            ext = '.jpg'
                        elif 'image/webp' in content_type:
                            ext = '.webp'
                        else:
                            parsed = urlparse(preview_url)
                            ext = os.path.splitext(parsed.path)[1] or '.png'

                        preview_filename = save_preview_image(
                            preview_dir=preview_dir,
                            extension=ext,
                            source_bytes=response.content
                        )

                        if preview_filename:
                            preview_path = url_for('static', filename=f'preview/{preview_filename}')
                        else:
                            preview_path = preview_url

                    elif preview_url.startswith('/static/'):
                        rel_path = preview_url.split('/static/')[1]
                        source_path = os.path.join(app.static_folder, rel_path)

                        if os.path.exists(source_path):
                            ext = os.path.splitext(source_path)[1] or '.png'
                            preview_filename = save_preview_image(
                                preview_dir=preview_dir,
                                extension=ext,
                                source_path=source_path
                            )

                            if preview_filename:
                                preview_path = url_for('static', filename=f'preview/{preview_filename}')
                            else:
                                preview_path = preview_url
                        else:
                            preview_path = preview_url
                    else:
                        preview_path = preview_url

                except Exception as e:
                    print(f"Error processing preview image URL: {e}")
                    preview_path = preview_url

        if builtin_index is not None:
            prompts_path = os.path.join(os.path.dirname(__file__), 'prompts.json')
            if not os.path.exists(prompts_path):
                return jsonify({'error': 'Prompts file not found'}), 404

            try:
                with open(prompts_path, 'r', encoding='utf-8') as f:
                    builtin_prompts = json.load(f)
            except json.JSONDecodeError:
                return jsonify({'error': 'Unable to read prompts.json'}), 500

            if not isinstance(builtin_prompts, list) or builtin_index < 0 or builtin_index >= len(builtin_prompts):
                return jsonify({'error': 'Invalid builtin template index'}), 400

            existing_template = builtin_prompts[builtin_index]
            old_preview = existing_template.get('preview', '')

            if preview_path and old_preview and '/preview/' in old_preview:
                try:
                    old_filename = old_preview.split('/preview/')[-1]
                    old_filepath = os.path.join(preview_dir, old_filename)
                    if os.path.exists(old_filepath):
                        os.remove(old_filepath)
                except Exception as e:
                    print(f"Error deleting old preview image: {e}")

            existing_template['title'] = title
            existing_template['prompt'] = prompt
            existing_template['mode'] = mode
            existing_template['category'] = category
            if preview_path:
                existing_template['preview'] = preview_path
            existing_template['tags'] = tags
            builtin_prompts[builtin_index] = existing_template

            with open(prompts_path, 'w', encoding='utf-8') as f:
                json.dump(builtin_prompts, f, indent=4, ensure_ascii=False)

            existing_template['builtinTemplateIndex'] = builtin_index
            return jsonify({'success': True, 'template': existing_template})

        # Fallback to user template update
        user_prompts_path = os.path.join(os.path.dirname(__file__), 'user_prompts.json')
        user_prompts = []

        if os.path.exists(user_prompts_path):
            try:
                with open(user_prompts_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if content.strip():
                        user_prompts = json.loads(content)
            except json.JSONDecodeError:
                pass

        if template_index < 0 or template_index >= len(user_prompts):
            return jsonify({'error': 'Invalid template index'}), 400

        old_template = user_prompts[template_index]
        old_preview = old_template.get('preview', '')
        if preview_path and old_preview and '/preview/' in old_preview:
            try:
                old_filename = old_preview.split('/preview/')[-1]
                old_filepath = os.path.join(preview_dir, old_filename)
                if os.path.exists(old_filepath):
                    os.remove(old_filepath)
            except Exception as e:
                print(f"Error deleting old preview image: {e}")

        user_prompts[template_index] = {
            'title': title,
            'prompt': prompt,
            'mode': mode,
            'category': category,
            'preview': preview_path,
            'tags': tags
        }

        with open(user_prompts_path, 'w', encoding='utf-8') as f:
            json.dump(user_prompts, f, indent=4, ensure_ascii=False)

        user_prompts[template_index]['isUserTemplate'] = True
        user_prompts[template_index]['userTemplateIndex'] = template_index
        return jsonify({'success': True, 'template': user_prompts[template_index]})

    except Exception as e:
        print(f"Error updating template: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/delete_template', methods=['POST'])
def delete_template():
    try:
        template_index = request.form.get('template_index')
        if template_index is None:
             return jsonify({'error': 'Template index is required'}), 400
        
        try:
            template_index = int(template_index)
        except ValueError:
            return jsonify({'error': 'Invalid template index'}), 400

        user_prompts_path = os.path.join(os.path.dirname(__file__), 'user_prompts.json')
        if not os.path.exists(user_prompts_path):
            return jsonify({'error': 'User prompts file not found'}), 404
            
        with open(user_prompts_path, 'r', encoding='utf-8') as f:
            user_prompts = json.load(f)
            
        if template_index < 0 or template_index >= len(user_prompts):
            return jsonify({'error': 'Template not found'}), 404
            
        template_to_delete = user_prompts[template_index]
        
        # Delete preview image if it exists and is local
        preview_path = template_to_delete.get('preview')
        if preview_path and '/static/preview/' in preview_path:
            # Extract filename
            try:
                filename = preview_path.split('/static/preview/')[1]
                preview_dir = os.path.join(app.static_folder, 'preview')
                filepath = os.path.join(preview_dir, filename)
                if os.path.exists(filepath):
                    os.remove(filepath)
            except Exception as e:
                print(f"Error deleting preview image: {e}")

        # Remove from list
        del user_prompts[template_index]
        
        # Save back
        with open(user_prompts_path, 'w', encoding='utf-8') as f:
            json.dump(user_prompts, f, indent=4, ensure_ascii=False)
            
        return jsonify({'success': True})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/refine_prompt', methods=['POST'])
def refine_prompt():
    data = request.get_json()
    current_prompt = data.get('current_prompt')
    instruction = data.get('instruction')
    api_key = data.get('api_key') or os.environ.get('GOOGLE_API_KEY')

    if not api_key:
        return jsonify({'error': 'API Key is required.'}), 401
    
    if not instruction:
        return jsonify({'error': 'Instruction is required'}), 400

    try:
        client = genai.Client(api_key=api_key)
        
        system_instruction = "You are an expert prompt engineer for image generation AI. Rewrite the prompt to incorporate the user's instruction while maintaining the original intent and improving quality. Return ONLY the new prompt text, no explanations."
        
        prompt_content = f"Current prompt: {current_prompt}\nUser instruction: {instruction}\nNew prompt:"
        
        print(f"Refining prompt with instruction: {instruction}")
        
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[prompt_content],
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
            )
        )
        
        if response.text:
            return jsonify({'refined_prompt': response.text.strip()})
        else:
            return jsonify({'error': 'No response from AI'}), 500

    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=8888)
