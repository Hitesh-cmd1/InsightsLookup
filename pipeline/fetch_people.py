import requests
from pipeline.download import download_profile
from db.models import Employee, SessionLocal, init_db

def get_profile_id(profile):
    if "*entityResult" in profile:
        return profile["*entityResult"].split(":")[6].split(",")[0]

def get_people(cookie, start=0,school_id=None, past_org=None, keyword=None):
    print(start)
    # Initialize database tables if they don't exist
    init_db()
    db = SessionLocal()
    filter = ""
    if school_id:
        filter = filter + ",(key:schoolFilter,value:List("+str(school_id)+"))" #,(key:facetFieldOfStudy,value:List(100674,100905,101409,100417,100078,100069))"

    if past_org:
        filter = filter + ",(key:pastCompany,value:List("+str(past_org)+"))"
    keyword_filter= ""
    if keyword:
        keyword_filter = "keywords:"+keyword+","

    url = "https://www.linkedin.com/voyager/api/graphql?variables=(start:"+str(start)+",origin:FACETED_SEARCH,query:("+keyword_filter+"flagshipSearchIntent:SEARCH_SRP,queryParameters:List((key:resultType,value:List(PEOPLE))"+filter+"),includeFiltersInResponse:false))&queryId=voyagerSearchDashClusters.ef3d0937fb65bd7812e32e5a85028e79"
    print(url)
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
    print(response)
    if response.status_code == 200:
        resp = response.json()
        items =  resp["data"]["data"]["searchDashClustersByAll"]["elements"][0]["items"]
        profile_ids = []
        item_count = 0
        for item in items:
            profile = item["item"]
            profile_id = get_profile_id(profile)
            if profile_id:
                profile_ids.append(profile_id)
        if profile_ids:
            saved_profiles = db.query(Employee.profile_id).filter(Employee.profile_id.in_(profile_ids)).all()
            saved_profiles = [profile_id.profile_id for profile_id in saved_profiles]
            saved_profiles = set(saved_profiles)
            for profile_id in profile_ids:
                item_count = item_count + 1
                print(item_count+start)
                if profile_id not in saved_profiles:
                    download_profile(cookie, profile_id)
                else:
                    print("Skipping: Employee with profile_id '"+profile_id+"' already exists for fetch")
    db.close()