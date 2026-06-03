from openai import APIConnectionError, AuthenticationError, OpenAI, OpenAIError, RateLimitError

from api.rag_backend.config import settings


def get_openai_client() -> OpenAI:
    if not settings.openai_api_key:
        raise RuntimeError("OpenAI API key is not configured.")
    return OpenAI(api_key=settings.openai_api_key)


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []

    try:
        response = get_openai_client().embeddings.create(
            model=settings.openai_embedding_model,
            input=texts,
        )
    except AuthenticationError as exc:
        raise RuntimeError("OpenAI rejected the API key. Check OPENAI_API_KEY in Vercel.") from exc
    except RateLimitError as exc:
        raise RuntimeError("OpenAI rate limit reached. Please try again later.") from exc
    except APIConnectionError as exc:
        raise RuntimeError("Could not connect to OpenAI. Check internet, firewall, VPN, or proxy settings.") from exc
    except OpenAIError as exc:
        raise RuntimeError("OpenAI embedding request failed.") from exc

    return [item.embedding for item in response.data]
