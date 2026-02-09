import requests
from download import download_profile

def get_profile_id(profile):
    if "*entityResult" in profile:
        return profile["*entityResult"].split(":")[6].split(",")[0]

def get_people(queryId, cookie, start=0):

    url = "https://www.linkedin.com/voyager/api/graphql?variables=(start:"+str(start)+",origin:FACETED_SEARCH,query:(flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(PEOPLE)),(key:pastCompany,value:List(82091032))),includeFiltersInResponse:false))&queryId=voyagerSearchDashClusters."+queryId

    # Two cookies
    cookies = {
        "JSESSIONID": "a",
        "li_at": cookie,
    }

    # CSRF header (name may vary depending on backend)
    headers = {
        "Csrf-Token": "a",
        "Accept": "application/vnd.linkedin.normalized+json+2.1"
    }
    response = requests.get(url, headers=headers, cookies=cookies)
    if response.status_code == 200:
        resp = response.json()
        items =  resp["data"]["data"]["searchDashClustersByAll"]["elements"][0]["items"]
        profile_ids = []
        for item in items:
            profile = item["item"]
            profile_id = get_profile_id(profile)
            if profile_id:
                profile_ids.append(profile_id)
        for profile_id in profile_ids:
            download_profile(cookie, profile_id)
        return profile_ids