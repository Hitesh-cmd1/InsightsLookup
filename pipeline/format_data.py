from pdfquery import PDFQuery

# Allow this file to be run both as part of the `pipeline` package
# (e.g. `python -m pipeline.format_data`) and directly as a script
# (e.g. `python pipeline/format_data.py` from the project root).
try:
    # When imported as part of the package
    from pipeline.save import save
except ModuleNotFoundError:
    # When run directly, ensure the project root is on sys.path
    import os
    import sys

    current_dir = os.path.dirname(__file__)
    project_root = os.path.dirname(current_dir)
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    from pipeline.save import save


def _parse_pdf(file_name):
    """
    Core PDF parsing logic shared by:
    - Legacy pipeline.save (Employee/Experience/Education tables)
    - New profile resume parsing (true_* tables via backend)

    Returns (name, experience_list, education_list).
    """
    pdf = PDFQuery(file_name)
    pdf.load()
    pages = list(pdf.tree.getroot())
    experience = False
    education = False
    experience_list = []
    education_list = []
    edu = ["", ""]
    exp = [None, None, None, None]

    # Basic sanity check for LinkedIn-style export
    if not pages or not pages[0] or pages[0][0].get("height") != "26.0":
        return None, [], []

    name = list(list(pages[0])[0])[0].text
    for t in pages:
        for element in list(t):
            if element.tag == "LTTextLineHorizontal" and element.get("height") == "15.75":
                if len(list(element)) == 1:
                    if element[0].text.strip() == "Experience":
                        experience = True
                        education = False
                        continue
                    elif element[0].text.strip() == "Education":
                        experience = False
                        education = True
                    else:
                        experience = False
                        education = False
            elif experience and element.tag == "LTTextBoxHorizontal":
                is_address = False
                for exp_element in list(element):
                    if exp_element.tag == "LTTextLineHorizontal":
                        if exp_element.get("height") == "12.0":
                            exp[0] = exp_element.text.strip()
                        if exp_element.get("height") == "11.5":
                            exp[1] = exp_element.text.strip()
                        if exp_element.get("height") == "10.5":
                            if not exp[1]:
                                pass
                            elif is_address:
                                exp[3] = exp_element.text.strip()
                                experience_list.append(exp)
                                prev_org = exp[0]
                                exp = [prev_org, None, None, None]
                                break
                            else:
                                exp[2] = exp_element.text.strip()
                                is_address = True
            elif education:
                if (
                    element.tag == "LTTextLineHorizontal"
                    and len(list(element)) == 1
                    and element[0].tag == "LTTextBoxHorizontal"
                ):
                    if "(" in edu[1] and ")" in edu[1]:
                        education_list.append(edu)
                        edu = ["", ""]
                    if element.get("height") == "12.0":
                        edu[0] = edu[0] + " " + element[0].text.strip()
                    elif element.get("height") == "10.5":
                        if not ("Page" in element.text and "of" in element.text):
                            edu[1] = edu[1] + " " + element[0].text.strip()

    # Append any trailing education entry
    if edu[0] or edu[1]:
        education_list.append(edu)

    return name, experience_list, education_list


def format_text(file_name, profile_id):
    """
    Backwards-compatible entry point used by the LinkedIn ingest pipeline.
    Keeps writing into Employee/Experience/Education tables via pipeline.save.
    """
    name, experience_list, education_list = _parse_pdf(file_name)
    if not name:
        return
    save(name, profile_id, experience_list, education_list)


def parse_resume_for_user(file_name):
    """
    New helper for the Profile Page.
    Uses the same parsing logic but returns structured data instead of writing
    directly to Employee/Experience/Education tables.
    """
    name, experience_list, education_list = _parse_pdf(file_name)
    return {
        "name": name,
        "experiences": experience_list,
        "educations": education_list,
    }


if __name__ == "__main__":
    # Simple manual test helper
    data = parse_resume_for_user("/Users/hitesh/Downloads/Profile_57.pdf")
    print(data)