from pydantic import BaseModel


class UploadResponse(BaseModel):
    success: bool
    file_name: str
    chunks_created: int
    documents_indexed: int


class ChatRequest(BaseModel):
    question: str


class Source(BaseModel):
    file_name: str
    page: int | None = None
    text_preview: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
