from pdfquery import PDFQuery

def save_to_xml():
    pdf = PDFQuery('../link/ACoAADeOCIMBYsRFYDPUDngwP-7w3e1dbjMPp5c.pdf')
    pdf.load()
    # Convert the PDF object to an XML file
    with open('output1.xml', 'wb') as f:
        pdf.tree.write(f, pretty_print=True)

if __name__ == "__main__":
    save_to_xml()