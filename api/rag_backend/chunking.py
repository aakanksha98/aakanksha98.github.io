from dataclasses import dataclass


@dataclass(frozen=True)
class TextSection:
    text: str
    file_name: str
    page: int | None = None


@dataclass(frozen=True)
class TextChunk:
    text: str
    file_name: str
    page: int | None
    chunk_index: int


def chunk_sections(sections: list[TextSection], chunk_size: int = 1200, overlap: int = 200) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    chunk_index = 0

    for section in sections:
        text = " ".join(section.text.split())
        if not text:
            continue

        start = 0
        while start < len(text):
            end = min(start + chunk_size, len(text))
            chunk_text = text[start:end].strip()
            if chunk_text:
                chunks.append(
                    TextChunk(
                        text=chunk_text,
                        file_name=section.file_name,
                        page=section.page,
                        chunk_index=chunk_index,
                    )
                )
                chunk_index += 1

            if end == len(text):
                break
            start = max(end - overlap, start + 1)

    return chunks
