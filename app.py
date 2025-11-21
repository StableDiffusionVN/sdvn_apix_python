import os
import base64
import uuid
import glob
from flask import Flask, render_template, request, jsonify, url_for
from google import genai
from google.genai import types
from PIL import Image

app = Flask(__name__)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# Ensure generated directory exists inside Flask static folder
GENERATED_DIR = os.path.join(app.static_folder, 'generated')
os.makedirs(GENERATED_DIR, exist_ok=True)

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
    else:
        data = request.get_json() or {}
        prompt = data.get('prompt')
        aspect_ratio = data.get('aspect_ratio')
        resolution = data.get('resolution', '2K')
        api_key = data.get('api_key') or os.environ.get('GOOGLE_API_KEY')
        reference_files = []

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

        contents = [prompt]
        for reference in reference_files:
            try:
                reference.stream.seek(0)
                reference_image = Image.open(reference.stream)
                contents.append(reference_image)
            except Exception:
                continue

        response = client.models.generate_content(
            model="gemini-3-pro-image-preview",
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=['IMAGE'],
                image_config=types.ImageConfig(**image_config_args),
            )
        )

        for part in response.parts:
            if part.inline_data:
                image_bytes = part.inline_data.data
                
                # Save image to file
                filename = f"{uuid.uuid4()}.png"
                filepath = os.path.join(GENERATED_DIR, filename)
                with open(filepath, "wb") as f:
                    f.write(image_bytes)
                
                image_url = url_for('static', filename=f'generated/{filename}')
                image_data = base64.b64encode(image_bytes).decode('utf-8')
                return jsonify({
                    'image': image_url,
                    'image_data': image_data,
                })
        
        return jsonify({'error': 'No image generated'}), 500

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/gallery')
def get_gallery():
    # List all png files in generated dir, sorted by modification time (newest first)
    files = glob.glob(os.path.join(GENERATED_DIR, '*.png'))
    files.sort(key=os.path.getmtime, reverse=True)
    
    image_urls = [url_for('static', filename=f'generated/{os.path.basename(f)}') for f in files]
    response = jsonify({'images': image_urls})
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response

if __name__ == '__main__':
    app.run(debug=True, port=8888)
