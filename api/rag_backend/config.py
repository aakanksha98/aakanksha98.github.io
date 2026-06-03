import os

from dotenv import load_dotenv


load_dotenv()


class Settings:
    openai_api_key = os.getenv("OPENAI_API_KEY", "")
    openai_chat_model = os.getenv("OPENAI_CHAT_MODEL", "gpt-4.1-mini")
    openai_embedding_model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    database_url = os.getenv("DATABASE_URL", "")
    embedding_dimensions = int(os.getenv("EMBEDDING_DIMENSIONS", "1536"))
    max_upload_bytes = int(os.getenv("MAX_UPLOAD_BYTES", str(4 * 1024 * 1024)))


settings = Settings()
