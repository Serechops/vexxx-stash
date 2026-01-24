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
    pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stashtag_client")

STASHTAG_SPACE = "cc1234/stashtag_onnx"


def predict_tags(data):
    """
    Predict tags from a sprite image and VTT file.
    
    data: {
        "image_path": str,  # Path to sprite image
        "vtt_path": str,    # Path to VTT file (or vtt_content as string)
        "vtt_content": str, # Raw VTT content (if vtt_path not provided)
        "threshold": float  # Confidence threshold (default 0.4)
    }
    """
    try:
        image_path = data.get("image_path")
        vtt_path = data.get("vtt_path")
        vtt_content = data.get("vtt_content", "")
        threshold = data.get("threshold", 0.4)
        
        if not image_path or not os.path.exists(image_path):
            return {"success": False, "error": f"Image file not found: {image_path}"}
        
        # Read VTT content from file if path provided
        if vtt_path and os.path.exists(vtt_path):
            with open(vtt_path, 'r', encoding='utf-8') as f:
                vtt_content = f.read()
        
        if not vtt_content:
            return {"success": False, "error": "No VTT content provided"}
        
        logger.info(f"Connecting to StashTag space: {STASHTAG_SPACE}")
        client = Client(STASHTAG_SPACE)
        
        logger.info(f"Calling predict_tags with image: {image_path}, threshold: {threshold}")
        result = client.predict(
            image=handle_file(image_path),
            vtt=vtt_content,
            threshold=float(threshold),
            api_name="/predict_tags"
        )
        
        logger.info(f"StashTag predict_tags result: {result}")
        
        return {"success": True, "result": result}
        
    except Exception as e:
        logger.error(f"StashTag predict_tags error: {e}")
        return {"success": False, "error": str(e)}


def predict_markers(data):
    """
    Predict markers from a sprite image and VTT file.
    
    data: {
        "image_path": str,  # Path to sprite image
        "vtt_path": str,    # Path to VTT file (or vtt_content as string)
        "vtt_content": str, # Raw VTT content (if vtt_path not provided)
        "threshold": float  # Confidence threshold (default 0.4)
    }
    """
    try:
        image_path = data.get("image_path")
        vtt_path = data.get("vtt_path")
        vtt_content = data.get("vtt_content", "")
        threshold = data.get("threshold", 0.4)
        
        if not image_path or not os.path.exists(image_path):
            return {"success": False, "error": f"Image file not found: {image_path}"}
        
        # Read VTT content from file if path provided
        if vtt_path and os.path.exists(vtt_path):
            with open(vtt_path, 'r', encoding='utf-8') as f:
                vtt_content = f.read()
        
        if not vtt_content:
            return {"success": False, "error": "No VTT content provided"}
        
        logger.info(f"Connecting to StashTag space: {STASHTAG_SPACE}")
        client = Client(STASHTAG_SPACE)
        
        logger.info(f"Calling predict_markers with image: {image_path}, threshold: {threshold}")
        result = client.predict(
            image=handle_file(image_path),
            vtt=vtt_content,
            threshold=float(threshold),
            api_name="/predict_markers"
        )
        
        logger.info(f"StashTag predict_markers result: {result}")
        
        return {"success": True, "result": result}
        
    except Exception as e:
        logger.error(f"StashTag predict_markers error: {e}")
        return {"success": False, "error": str(e)}


def status(data):
    """Check if the StashTag service is available."""
    try:
        # Try to connect to the Gradio client
        client = Client(STASHTAG_SPACE)
        return {"status": "available", "message": "StashTag service is ready"}
    except Exception as e:
        logger.error(f"StashTag status check failed: {e}")
        return {"status": "unavailable", "error": str(e)}


def main():
    if len(sys.argv) < 2:
        result = {"error": "No command specified. Use: predict_tags, predict_markers, or status"}
        real_stdout.write(json.dumps(result))
        real_stdout.flush()
        return
    
    command = sys.argv[1]
    
    # Read input JSON from stdin
    input_data = {}
    try:
        input_str = sys.stdin.read()
        if input_str.strip():
            input_data = json.loads(input_str)
    except json.JSONDecodeError as e:
        result = {"error": f"Invalid JSON input: {e}"}
        real_stdout.write(json.dumps(result))
        real_stdout.flush()
        return
    
    # Route to appropriate function
    if command == "predict_tags":
        result = predict_tags(input_data)
    elif command == "predict_markers":
        result = predict_markers(input_data)
    elif command == "status":
        result = status(input_data)
    else:
        result = {"error": f"Unknown command: {command}"}
    
    # Output result to the real stdout (not redirected stderr)
    real_stdout.write(json.dumps(result))
    real_stdout.flush()


if __name__ == "__main__":
    main()
