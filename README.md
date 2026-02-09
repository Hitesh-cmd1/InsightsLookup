## InsightsLookup

Simple tooling to fetch LinkedIn profiles, download them as PDFs, parse out Experience/Education details, and store everything into Excel workbooks for later analysis.

### 1. Project structure

- **`app.py`**: CLI entry point. Takes a LinkedIn GraphQL `queryId`, an authenticated `li_at` cookie, and a `start` / `end` range, then calls `get_people` in `fetch_people.py`.
- **`fetch_people.py`**: Calls the LinkedIn Voyager GraphQL search API to get people search results, extracts profile IDs, and for each one calls `download_profile` from `download.py`.
- **`download.py`**: Uses a LinkedIn internal endpoint to trigger “Save profile to PDF”, downloads the PDF into `../link/<profile_id>.pdf`, and then calls `format_text` from `format_data.py`.
- **`format_data.py`**: Parses each LinkedIn profile PDF with `pdfquery`, extracts Experience and Education blocks, and hands the structured data to `save.save`.
- **`pdf_to_xlx.py`**: Utility to walk a folder of existing PDFs (by default `../link`) and run `format_text` on each, producing Excel output without calling the LinkedIn APIs again.
- **`save.py`**: Uses `pandas` to append/update several Excel files:
  - `empsheet.xlsx`: employee master (`ID`, `NAME`)
  - `expsheet.xlsx`: experience rows
  - `edu_sheet.xlsx`: education rows
  - `emp_exp_ids_sheet.xlsx`: employee → experience mapping
  - `emp_edu_ids_sheet.xlsx`: employee → education mapping

> **Note**: These scripts expect valid LinkedIn cookies and specific internal endpoints. Use them only in accordance with LinkedIn’s terms of service and applicable laws.

### 2. Requirements and installation

**Python version**: recommended Python 3.10+  
**OS**: Linux (project was developed on a Linux environment, but should work on other platforms with the right dependencies installed).

#### 2.1. Create and activate a virtual environment (recommended)

```bash
cd /path/to/InsightsLookup
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

#### 2.2. Install Python dependencies

All Python requirements are listed in `requirements.txt`:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

This will install:

- `requests`: HTTP client used to call LinkedIn APIs and download PDFs.
- `pdfquery`: Used to parse and query text/structure from PDF resumes.
- `pandas`: Used for building and updating Excel workbooks.
- `openpyxl`: Engine used by `pandas` to read/write `.xlsx` files.

> Depending on your platform, `pdfquery` may need system libraries for PDF and XML parsing (for example, `libxml2`, `libxslt`). If installation fails, check the `pdfquery` documentation for platform-specific instructions.

### 3. Required folders and files

- **`../link/` folder**: PDFs are written here by `download.py` and read from here by `pdf_to_xlx.py`.  
  From the project root (`InsightsLookup`), this resolves to a sibling directory named `link`.

Create it before running:

```bash
mkdir -p ../link
```

Excel files (`*.xlsx`) will be created in the project root on first run if they don’t already exist.

### 4. How to run

#### 4.1. Running the main fetcher (`app.py`)

`app.py` is the main entry point for pulling new LinkedIn profiles based on a search and generating PDFs/Excel rows.

Required arguments:

- `--queryId`: LinkedIn Voyager GraphQL query identifier that defines the search.
- `--cookie`: The `li_at` auth cookie value from a logged-in LinkedIn session.
- `--start`: Start index for search results (integer).
- `--end`: End index for search results (integer, non-inclusive).

Example:

```bash
python app.py \
  --queryId YOUR_QUERY_ID_HERE \
  --cookie YOUR_LI_AT_COOKIE_HERE \
  --start 0 \
  --end 50
```

This will:

1. Call `get_people` in `fetch_people.py` for each page in the range.
2. For each profile ID found, call `download_profile` in `download.py`.
3. Download profile PDFs into `../link`.
4. Parse each PDF with `format_data.format_text`.
5. Append/update rows in the Excel sheets using `save.save`.

#### 4.2. Reprocessing existing PDFs (`pdf_to_xlx.py`)

If you already have a set of PDFs (e.g., from a previous run), you can regenerate the Excel data without hitting LinkedIn again:

```bash
python pdf_to_xlx.py                # uses ../link by default
python pdf_to_xlx.py /path/to/pdfs  # custom folder
python pdf_to_xlx.py /path/to/pdfs --all  # include subdirectories
```

This will:

- List all files in the given folder (and optionally subfolders).
- Run `format_text` on each PDF.
- Update the Excel sheets in the current directory.

### 5. Script-by-script details

- **`app.py`**
  - Uses `argparse` to parse CLI arguments.
  - Loops from `start` to `end` in steps of 10, calling `get_people` each time.

- **`fetch_people.py`**
  - Builds a LinkedIn GraphQL URL with the provided `queryId`, `start` offset, and fixed filters (e.g., `resultType=PEOPLE`).
  - Sends a `GET` request with CSRF and cookie headers using `requests`.
  - Extracts profile IDs from the JSON response and passes each one to `download_profile`.

- **`download.py`**
  - Calls a LinkedIn internal endpoint to trigger "save profile to PDF".
  - Parses the response JSON to extract the PDF download URL.
  - Saves the PDF as `../link/<profile_id>.pdf`.
  - Calls `format_text` to parse and persist Experience/Education data.

- **`format_data.py`**
  - Uses `PDFQuery` to load the PDF and walk its internal layout tree.
  - Recognizes “Experience” and “Education” sections via text/height heuristics.
  - Builds `experience_list` and `education_list` for each profile.
  - Calls `save(name, experience_list, education_list)`.

- **`pdf_to_xlx.py`**
  - Utility/maintenance script.
  - Walks through a directory of PDFs and calls `format_text` for each file.

- **`save.py`**
  - Manages incremental IDs across multiple sheets (`ID` column).
  - Appends to or creates:
    - Employee master list (`empsheet.xlsx`).
    - Experience table (`expsheet.xlsx`).
    - Education table (`edu_sheet.xlsx`).
    - Relation tables (`emp_exp_ids_sheet.xlsx`, `emp_edu_ids_sheet.xlsx`).

### 6. Notes and caveats

- **LinkedIn terms of service**: Interacting with LinkedIn using unofficial APIs or scraping methods may violate their terms. This project is for personal/educational use only.
- **Fragility**: The LinkedIn endpoints, headers, and response formats used here are not public APIs and may change without notice, which would break the scripts.
- **Data quality**: The PDF parsing logic is tailored to LinkedIn’s current PDF layout; different or future layouts may require adjustments in `format_data.py`.

