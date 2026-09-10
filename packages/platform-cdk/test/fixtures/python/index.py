import json
import os


def handler(event, context):
    """Minimal handler used by PlatformPythonFunction tests."""
    return {
        "statusCode": 200,
        "body": json.dumps({"service": os.environ.get("PLATFORM_SERVICE"), "event": event}),
    }
