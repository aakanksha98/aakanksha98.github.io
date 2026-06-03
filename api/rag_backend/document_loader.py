import csv
from io import BytesIO, StringIO
from pathlib import Path

from pypdf import PdfReader

from api.rag_backend.chunking import TextSection


SUPPORTED_EXTENSIONS = {".pdf", ".txt", ".csv"}


def validate_file_name(file_name: str) -> str:
    safe_name = Path(file_name).name
    if not safe_name:
        raise ValueError("File name is required.")

    extension = Path(safe_name).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError("Only PDF, TXT, and CSV files are supported.")

    return safe_name


def extract_sections(file_name: str, content: bytes) -> list[TextSection]:
    if not content:
        raise ValueError("The uploaded file is empty.")

    extension = Path(file_name).suffix.lower()
    if extension == ".pdf":
        return _extract_pdf(file_name, content)
    if extension == ".txt":
        return _extract_text(file_name, content)
    if extension == ".csv":
        return _extract_csv(file_name, content)

    raise ValueError("Only PDF, TXT, and CSV files are supported.")


def _extract_pdf(file_name: str, content: bytes) -> list[TextSection]:
    reader = PdfReader(BytesIO(content))
    sections: list[TextSection] = []

    for page_index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            sections.append(TextSection(text=text, file_name=file_name, page=page_index))

    if not sections:
        raise ValueError("No readable text was found in this PDF.")

    return sections


def _extract_text(file_name: str, content: bytes) -> list[TextSection]:
    text = _decode_text(content)
    if not text.strip():
        raise ValueError("No readable text was found in this text file.")
    return [TextSection(text=text, file_name=file_name)]


def _extract_csv(file_name: str, content: bytes) -> list[TextSection]:
    text = _decode_text(content)
    rows = csv.reader(StringIO(text))
    lines = [", ".join(cell.strip() for cell in row if cell.strip()) for row in rows]
    readable_text = "\n".join(line for line in lines if line)

    if not readable_text.strip():
        raise ValueError("No readable text was found in this CSV file.")

    return [TextSection(text=readable_text, file_name=file_name)]


def _decode_text(content: bytes) -> str:
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return content.decode("latin-1")
