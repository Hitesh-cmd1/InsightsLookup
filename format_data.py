
from pdfquery import PDFQuery
from save import save



def format_text(file_name):

    pdf = PDFQuery(file_name)
    pdf.load()
    pages = list(pdf.tree.getroot())
    experience = False
    education = False
    experience_list = []
    education_list = []
    edu = [None,None]
    exp = [None, None, None,None]
    name = list(list(pages[0])[0])[0].text
    for t in pages:
        for element in list(t):
            if element.tag == 'LTTextLineHorizontal' and element.get("height") == '15.75':
                if len(list(element)) == 1:
                    if element[0].text.strip() == 'Experience':
                        experience = True
                        education = False
                        continue
                    elif element[0].text.strip() == 'Education':
                        experience = False
                        education = True
                    else:
                        experience = False
                        education = False
            elif experience and element.tag == 'LTTextBoxHorizontal':
                is_address = False
                for exp_element in list(element):
                    if exp_element.tag == 'LTTextLineHorizontal':
                        if  exp_element.get("height") == '12.0':
                            exp[0] = exp_element.text.strip()
                        if exp_element.get("height") == '11.5':
                            exp[1] = exp_element.text.strip()
                        if exp_element.get("height") == '10.5':
                            if not exp[1]:
                                pass
                            elif is_address:
                                exp[3] = exp_element.text.strip()
                                experience_list.append(exp)
                                prev_org = exp[0]
                                exp = [prev_org, None, None,None]
                                break
                            else:
                                exp[2] = exp_element.text.strip()
                                is_address = True
            elif education:
                if element.tag == 'LTTextLineHorizontal' and len(list(element))==1 and element[0].tag == 'LTTextBoxHorizontal':
                    if element.get("height") == '12.0':
                        edu[0] = element[0].text.strip()
                    elif element.get("height") == '10.5':
                        edu[1] = element[0].text.strip()
                        education_list.append(edu)
                        edu = [None,None]
    save(name, experience_list, education_list)
    