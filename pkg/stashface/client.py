import sys
import json
import logging
import os
import io

# Force UTF-8 for stdout/stderr to handle tqdm/gradio characters on Windows
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# Keep a reference to the actual stdout for the final JSON output
real_stdout = sys.stdout
# Redirect standard print() calls and library stdout usage to stderr so they don't corrupt our JSON output
sys.stdout = sys.stderr

try:
    from gradio_client import Client, handle_file
except ImportError:
    # If not installed, we can't do much.
    pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stashface_client")

def identify(data):
    try:
        # data contains paths to files
        image_path = data.get("image_path")
        vtt_path = data.get("vtt_path")
        threshold = data.get("threshold", 0.5)
        
        if not image_path or not os.path.exists(image_path):
             return {"error": f"Image file not found: {image_path}"}
        
        # We assume the Space takes the image path directly
        # If it needed the VTT, we would pass it too. 
        # For now, let's look at what arguments the space likely takes.
        # If it's a standard face detection space, it probably just takes an image.
        # But since we are doing StashFace (performer ID), maybe it logic is inside the space?
        # Actually, StashFace logic usually involves checking against a DB, but here we are calling a Space.
        # Let's assume the Space takes the image and returns bounding boxes and maybe embeddings/names.
        
        client = Client("cc1234/stashface")
        
        # Log the available API endpoints to stderr for debugging
        try:
             logger.info("Available API endpoints:")
             client.view_api()
        except Exception as e:
             logger.error(f"Error viewing API: {e}")

        # We need to use handle_file for file uploads in Gradio 5+ / recent client
        
        if vtt_path and os.path.exists(vtt_path):
             # Using the API endpoint for sprite scanning
             # Note: Docs suggest it only takes image and vtt_file
             result = client.predict(
                image=handle_file(image_path),
                vtt_file=handle_file(vtt_path),
                api_name="/find_faces_in_sprite"
             )
        else:
             # Use standard image search for single images
             # Docs: img, threshold, results
             result = client.predict(
                img=handle_file(image_path),
                threshold=float(threshold),
                results=float(data.get("results", 3)),
                api_name="/multiple_image_search"
             )
        
        # Return the result as is, or wrap it
        logger.info(f"Gradio result: {result}")
        # If result is just the data, we might need to conform to what frontend expects.
        # Frontend expects: { faces: [...] }
        # If result is that, great. If result is just the list, we wrap it.
        # If result is wrapped in "result" key by us, we double wrap it?
        
        # Let's adjust to return keys that merging into the final JSON makes sense.
        # We previously returned {"result": result}.
        # Any dict returned here is json dumped.
        
        # If result is a list (faces), map it to faces.
        if isinstance(result, list):
             # Normalize keys to ensure frontend compatibility
             normalized = []
             for face in result:
                 # Ensure confidence
                 if "confidence" not in face and "score" in face:
                     face["confidence"] = face["score"]
                 if "confidence" not in face:
                     face["confidence"] = 0.0
                 
                 # Ensure performers
                 if "performers" not in face:
                     face["performers"] = []
                     
                 normalized.append(face)
             return {"faces": normalized}
        
        # If result is a dict
        if isinstance(result, dict):
             # Check for error explicitly
             if "error" in result:
                  return result
             
             # If it has "faces", return as is.
             if "faces" in result:
                  return result
             # If it doesn't, maybe the whole dict is one face? Unlikely.
             # Or maybe it's { "data": ... }
             return {"faces": [result]} # hazardous guess
             
        # If result is None or other
        return {"faces": [], "debug_raw_result": str(result)} 
    except Exception as e:
        logger.error(f"Identify error: {e}")
        return {"error": str(e)}

def status():
    try:
        from gradio_client import Client
        return {"status": "available", "message": "Client library found"}
    except ImportError:
        return {"status": "unavailable", "message": "gradio_client not installed"}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command provided"}))
        sys.exit(1)

    command = sys.argv[1]
    
    # Read input from stdin
    input_str = sys.stdin.read()
    input_data = {}
    if input_str:
        try:
            input_data = json.loads(input_str)
        except:
            pass

    result = {}
    if command == "status":
        result = status()
    elif command == "identify":
        result = identify(input_data)
    else:
        result = {"error": f"Unknown command: {command}"}

    real_stdout.write(json.dumps(result, default=str) + "\n")
    real_stdout.flush()
