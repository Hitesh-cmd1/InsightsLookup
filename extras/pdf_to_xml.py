from pdfquery import PDFQuery

def save_to_xml():
    pdf = PDFQuery('/Users/hitesh/Downloads/Profile_57.pdf')
    pdf.load()
    pages = list(pdf.tree.getroot())

    print(pages[0][0].get("height"))
    # Convert the PDF object to an XML file
    with open('output1.xml', 'wb') as f:
        pdf.tree.write(f, pretty_print=True)

if __name__ == "__main__":
    save_to_xml()