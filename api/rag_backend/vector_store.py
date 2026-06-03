from uuid import uuid4

import psycopg

from api.rag_backend.chunking import TextChunk
from api.rag_backend.config import settings


_database_ready = False


def index_chunks(chunks: list[TextChunk], embeddings: list[list[float]]) -> int:
    if len(chunks) != len(embeddings):
        raise RuntimeError("Chunk and embedding counts do not match.")

    if not chunks:
        return 0

    try:
        ensure_database()
        document_id = uuid4()
        rows = [
            (
                uuid4(),
                document_id,
                chunk.file_name,
                chunk.page,
                chunk.chunk_index,
                chunk.text,
                _format_vector(embedding),
            )
            for chunk, embedding in zip(chunks, embeddings)
        ]

        with get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO documents (id, file_name, chunk_count)
                    VALUES (%s, %s, %s)
                    """,
                    (document_id, chunks[0].file_name, len(chunks)),
                )
                cursor.executemany(
                    """
                    INSERT INTO document_chunks
                        (id, document_id, file_name, page, chunk_index, text, embedding)
                    VALUES
                        (%s, %s, %s, %s, %s, %s, %s::vector)
                    """,
                    rows,
                )
        return len(chunks)
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("Vector database indexing failed.") from exc


def query_chunks(question_embedding: list[float], top_k: int = 4) -> list[dict]:
    try:
        ensure_database()
        vector = _format_vector(question_embedding)
        with get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT text, file_name, page, embedding <=> %s::vector AS distance
                    FROM document_chunks
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                    """,
                    (vector, vector, top_k),
                )
                rows = cursor.fetchall()
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("Vector database query failed.") from exc

    return [
        {
            "text": text,
            "file_name": file_name,
            "page": page,
            "distance": float(distance),
        }
        for text, file_name, page, distance in rows
    ]


def ensure_database() -> None:
    global _database_ready
    if _database_ready:
        return

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured.")

    try:
        with get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS documents (
                        id UUID PRIMARY KEY,
                        file_name TEXT NOT NULL,
                        chunk_count INTEGER NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cursor.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS document_chunks (
                        id UUID PRIMARY KEY,
                        document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        file_name TEXT NOT NULL,
                        page INTEGER,
                        chunk_index INTEGER NOT NULL,
                        text TEXT NOT NULL,
                        embedding vector({settings.embedding_dimensions}) NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cursor.execute(
                    """
                    CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx
                    ON document_chunks (document_id)
                    """
                )
        _database_ready = True
    except Exception as exc:
        raise RuntimeError("Vector database is unavailable.") from exc


def get_connection():
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured.")
    return psycopg.connect(settings.database_url, autocommit=True)


def _format_vector(values: list[float]) -> str:
    if len(values) != settings.embedding_dimensions:
        raise RuntimeError(
            f"Embedding dimension mismatch. Expected {settings.embedding_dimensions}, got {len(values)}."
        )
    return "[" + ",".join(str(value) for value in values) + "]"
