import os
import base64
import uuid
import glob
import json
from datetime import datetime
from io import BytesIO
from send2trash import send2trash
from flask import Flask, render_template, request, jsonify, url_for
from google import genai
from google.genai import types
from PIL import Image, PngImagePlugin

app = Flask(__name__)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

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
        response = client.models.generate_content(
            model=model_name,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=['IMAGE'],
                image_config=types.ImageConfig(**image_config_args),
            )
        )

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
                all_prompts.extend(json.load(f))
            
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
                        all_prompts.extend(user_prompts)
            except json.JSONDecodeError:
                pass # Ignore if empty or invalid
        
        # Filter by category if specified
        if category:
            all_prompts = [p for p in all_prompts if p.get('category') == category]
        
        response = jsonify({'prompts': all_prompts})
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
                ext = os.path.splitext(file.filename)[1]
                if not ext:
                    ext = '.png'
                    
                filename = f"template_{uuid.uuid4()}{ext}"
                filepath = os.path.join(preview_dir, filename)
                file.save(filepath)
                
                preview_path = url_for('static', filename=f'preview/{filename}')
        
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
                        
                        filename = f"template_{uuid.uuid4()}{ext}"
                        filepath = os.path.join(preview_dir, filename)
                        
                        with open(filepath, 'wb') as f:
                            f.write(response.content)
                        
                        preview_path = url_for('static', filename=f'preview/{filename}')
                    
                    elif preview_url.startswith('/static/'):
                        # Local path - copy to preview folder
                        rel_path = preview_url.split('/static/')[1]
                        source_path = os.path.join(app.static_folder, rel_path)
                        
                        if os.path.exists(source_path):
                            ext = os.path.splitext(source_path)[1] or '.png'
                            filename = f"template_{uuid.uuid4()}{ext}"
                            dest_path = os.path.join(preview_dir, filename)
                            
                            import shutil
                            shutil.copy2(source_path, dest_path)
                            
                            preview_path = url_for('static', filename=f'preview/{filename}')
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
            'preview': preview_path
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
        
        # Get template index
        template_index = request.form.get('template_index')
        if template_index is None:
            return jsonify({'error': 'Template index is required'}), 400
        
        template_index = int(template_index)
        
        # Handle multipart form data
        title = request.form.get('title')
        prompt = request.form.get('prompt')
        mode = request.form.get('mode', 'generate')
        category = request.form.get('category', 'User')
        
        if not title or not prompt:
            return jsonify({'error': 'Title and prompt are required'}), 400
            
        # Handle preview image (same logic as save_template)
        preview_path = None
        preview_dir = os.path.join(app.static_folder, 'preview')
        os.makedirs(preview_dir, exist_ok=True)
        
        # Check if file was uploaded
        if 'preview' in request.files:
            file = request.files['preview']
            if file.filename:
                ext = os.path.splitext(file.filename)[1]
                if not ext:
                    ext = '.png'
                    
                filename = f"template_{uuid.uuid4()}{ext}"
                filepath = os.path.join(preview_dir, filename)
                file.save(filepath)
                
                preview_path = url_for('static', filename=f'preview/{filename}')
        
        # If no file uploaded, check if URL/path provided
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
                        
                        filename = f"template_{uuid.uuid4()}{ext}"
                        filepath = os.path.join(preview_dir, filename)
                        
                        with open(filepath, 'wb') as f:
                            f.write(response.content)
                        
                        preview_path = url_for('static', filename=f'preview/{filename}')
                    
                    elif preview_url.startswith('/static/'):
                        rel_path = preview_url.split('/static/')[1]
                        source_path = os.path.join(app.static_folder, rel_path)
                        
                        if os.path.exists(source_path):
                            ext = os.path.splitext(source_path)[1] or '.png'
                            filename = f"template_{uuid.uuid4()}{ext}"
                            dest_path = os.path.join(preview_dir, filename)
                            
                            import shutil
                            shutil.copy2(source_path, dest_path)
                            
                            preview_path = url_for('static', filename=f'preview/{filename}')
                        else:
                            preview_path = preview_url
                    else:
                        preview_path = preview_url
                        
                except Exception as e:
                    print(f"Error processing preview image URL: {e}")
                    preview_path = preview_url
        
        # Read existing user templates
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
        
        # Check if index is valid
        if template_index < 0 or template_index >= len(user_prompts):
            return jsonify({'error': 'Invalid template index'}), 400
        
        # Get old template to check for old preview image
        old_template = user_prompts[template_index]
        old_preview = old_template.get('preview', '')
        
        # Delete old preview image if it exists in the preview folder
        if old_preview and '/preview/' in old_preview:
            try:
                # Extract filename from URL
                old_filename = old_preview.split('/preview/')[-1]
                old_filepath = os.path.join(preview_dir, old_filename)
                
                # Delete old file if it exists
                if os.path.exists(old_filepath):
                    os.remove(old_filepath)
                    print(f"Deleted old preview image: {old_filepath}")
            except Exception as e:
                print(f"Error deleting old preview image: {e}")
        
        # Update the template
        user_prompts[template_index] = {
            'title': title,
            'prompt': prompt,
            'mode': mode,
            'category': category,
            'preview': preview_path
        }
        
        # Save back to file
        with open(user_prompts_path, 'w', encoding='utf-8') as f:
            json.dump(user_prompts, f, indent=4, ensure_ascii=False)
            
        return jsonify({'success': True, 'template': user_prompts[template_index]})
        
    except Exception as e:
        print(f"Error updating template: {e}")
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
