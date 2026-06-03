from openai import OpenAIError

from api.rag_backend.config import settings
from api.rag_backend.embeddings import embed_texts, get_openai_client
from api.rag_backend.models import Source
from api.rag_backend.vector_store import query_chunks


SYSTEM_PROMPT = """You are a company knowledge assistant.
Answer the user's question using only the provided document context.
If the context does not contain the answer, say you do not know from the uploaded documents.
Keep the answer concise and cite the source names naturally when useful."""


def answer_question(question: str) -> tuple[str, list[Source]]:
    cleaned_question = question.strip()
    if not cleaned_question:
        raise ValueError("Question is required.")

    question_embedding = embed_texts([cleaned_question])[0]
    matches = query_chunks(question_embedding)

    if not matches:
        return "I do not have any indexed document context yet. Upload a document first.", []

    context = _build_context(matches)
    user_prompt = f"""Document context:
{context}

Question:
{cleaned_question}"""

    try:
        response = get_openai_client().chat.completions.create(
            model=settings.openai_chat_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
    except OpenAIError as exc:
        raise RuntimeError("Answer generation failed.") from exc

    answer = response.choices[0].message.content or "I could not generate an answer."
    sources = [
        Source(
            file_name=match["file_name"],
            page=match["page"],
            text_preview=_preview(match["text"]),
        )
        for match in matches
    ]
    return answer, sources


def _build_context(matches: list[dict]) -> str:
    blocks = []
    for index, match in enumerate(matches, start=1):
        page_text = f", page {match['page']}" if match["page"] else ""
        blocks.append(f"[Source {index}: {match['file_name']}{page_text}]\n{match['text']}")
    return "\n\n".join(blocks)


def _preview(text: str, limit: int = 180) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."
