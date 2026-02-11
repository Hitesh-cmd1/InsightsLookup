import json
import requests
from pathlib import Path
from pipeline.format_data import format_text

def download_profile(cookie, profile_id):
    url = "https://www.linkedin.com/flagship-web/rsc-action/actions/server-request"
    cookies = {
        "JSESSIONID": "a",
        "li_at": cookie,
    }
    headers = {
        "Csrf-Token": "a",
        "Content-Type": "application/json"
    }

    payload = {
        "requestId": "com.linkedin.sdui.requests.profile.saveProfileToPdf",
        "serverRequest": {
            "$type": "proto.sdui.actions.core.ServerRequest",
            "requestId": "com.linkedin.sdui.requests.profile.saveProfileToPdf",
            "requestedArguments": {
                "$type": "proto.sdui.actions.requests.RequestedArguments",
                "payload": {
                    "profileId": profile_id
                },
                "requestedStateKeys": [],
                "requestMetadata": {
                    "$type": "proto.sdui.common.RequestMetadata"
                }
            }
        },
        "states": [],
        "requestedArguments": {
            "$type": "proto.sdui.actions.requests.RequestedArguments",
            "payload": {
                "profileId": profile_id
            },
            "requestedStateKeys": [],
            "requestMetadata": {
                "$type": "proto.sdui.common.RequestMetadata"
            },
            "states": [],
            "screenId": "com.linkedin.sdui.flagshipnav.profile.Profile"
        }
    }
    response = requests.post(url, headers=headers, cookies=cookies, json=payload)
    if response.status_code == 200:
        resp =  response.content.decode("utf-8")
        format_data = json.loads(resp.split("0:")[1])
        print(format_data)
        if "content" in format_data["response"]["completionAction"]["actions"][0]["value"]:
            download_url = format_data["response"]["completionAction"]["actions"][0]["value"]["content"]["url"]["url"]
            filename = Path("../link/"+profile_id+".pdf")
            data = requests.get(download_url, cookies=cookies, headers=headers)
            filename.write_bytes(data.content)
            format_text(filename)


