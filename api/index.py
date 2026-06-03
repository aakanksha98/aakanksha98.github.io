from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from api.rag_backend.chunking import chunk_sections
from api.rag_backend.config import settings
from api.rag_backend.document_loader import extract_sections, validate_file_name
from api.rag_backend.embeddings import embed_texts
from api.rag_backend.models import ChatRequest, ChatResponse, UploadResponse
from api.rag_backend.rag import answer_question
from api.rag_backend.vector_store import index_chunks


app = FastAPI(title="Enterprise RAG Chatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
@app.get("/health")
def health():
    return {
        "status": "ok",
        "openai_configured": bool(settings.openai_api_key),
        "database_configured": bool(settings.database_url),
    }


@app.post("/api/upload", response_model=UploadResponse)
@app.post("/upload", response_model=UploadResponse)
async def upload_document(file: UploadFile = File(...)):
    try:
        file_name = validate_file_name(file.filename or "")
        content = await file.read()
        if len(content) > settings.max_upload_bytes:
            max_mb = settings.max_upload_bytes / (1024 * 1024)
            raise ValueError(f"File is too large for this demo. Maximum size is {max_mb:.1f} MB.")

        sections = extract_sections(file_name, content)
        chunks = chunk_sections(sections)
        if not chunks:
            raise ValueError("No readable text chunks were created from this file.")

        embeddings = embed_texts([chunk.text for chunk in chunks])
        documents_indexed = index_chunks(chunks, embeddings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Upload failed while indexing the document.") from exc

    return UploadResponse(
        success=True,
        file_name=file_name,
        chunks_created=len(chunks),
        documents_indexed=documents_indexed,
    )


@app.post("/api/chat", response_model=ChatResponse)
@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    try:
        answer, sources = answer_question(request.question)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Chat failed while generating an answer.") from exc

    return ChatResponse(answer=answer, sources=sources)
