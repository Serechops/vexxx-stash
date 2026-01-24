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
logger = logging.getLogger("megaface_client")

MEGAFACE_SPACE = "cc1234/megaface"


def identify(data):
    """
    Identify performers in an image using MegaFace.
    
    data: {
        "image_path": str,  # Path to image file
    }
    
    Returns: {
        "success": bool,
        "result": str (HTML output from MegaFace),
        "error": str (if failed)
    }
    """
    try:
        image_path = data.get("image_path")
        
        if not image_path or not os.path.exists(image_path):
            return {"success": False, "error": f"Image file not found: {image_path}"}
        
        logger.info(f"Connecting to MegaFace space: {MEGAFACE_SPACE}")
        client = Client(MEGAFACE_SPACE)
        
        logger.info(f"Calling multiple_image_search_with_visual with image: {image_path}")
        result = client.predict(
            img=handle_file(image_path),
            api_name="/multiple_image_search_with_visual"
        )
        
        logger.info(f"MegaFace result type: {type(result)}")
        
        # Result is HTML string from MegaFace
        return {"success": True, "result": result}
        
    except Exception as e:
        logger.error(f"MegaFace identify error: {e}")
        return {"success": False, "error": str(e)}


def status():
    """Check if MegaFace client is available."""
    try:
        from gradio_client import Client
        return {"status": "available", "message": "MegaFace client library found"}
    except ImportError:
        return {"status": "unavailable", "message": "gradio_client not installed"}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        real_stdout.write(json.dumps({"error": "No command provided"}) + "\n")
        real_stdout.flush()
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
