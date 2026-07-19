#!/usr/bin/env python3
"""
批量上传 PDF 到 doc-qa-agent 数据库
- 提取文本 → 递归切分 → 智谱 Embedding → Supabase 入库
"""

import os
import sys
import json
import time
import requests
from pathlib import Path

# ---- 配置 ----
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
ZHIPU_KEY = os.environ.get("ZHIPU_API_KEY", "")

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
EMBED_MODEL = "embedding-3"
EMBED_DIM = 1024
BATCH_SIZE = 20  # 每批 embedding 请求数


def load_env(dotenv_path):
    """简易 .env.local 加载"""
    with open(dotenv_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def extract_text(pdf_path: str) -> str:
    from pypdf import PdfReader
    reader = PdfReader(pdf_path)
    texts = []
    for page in reader.pages:
        t = page.extract_text()
        if t:
            # 清除 null 字节，PostgreSQL 不支持 \u0000
            t = t.replace('\x00', '')
            texts.append(t)
    return "\n".join(texts)


def split_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """递归切分（简化版，匹配 TypeScript splitter 的行为）"""
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        if chunks and overlap > 0:
            # 前一个 chunk 末尾 overlap 拼到当前 chunk 开头
            prev_tail = chunks[-1][-overlap:]
            chunk = prev_tail + chunk
            if len(chunk) > chunk_size:
                chunk = chunk[-chunk_size:]
        chunks.append(chunk)
        start = end - overlap  # 下一个 chunk 从 overlap 处开始
    return chunks


def embed_batch(texts: list[str]) -> list[list[float]]:
    """调用智谱 Embedding API"""
    url = "https://open.bigmodel.cn/api/paas/v4/embeddings"
    headers = {
        "Authorization": f"Bearer {ZHIPU_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": EMBED_MODEL,
        "input": texts,
        "dimensions": EMBED_DIM,  # 必须显式指定 1024，否则默认 2048 与数据库不匹配
    }
    resp = requests.post(url, json=body, headers=headers, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    # 按 index 排序确保顺序
    sorted_data = sorted(data["data"], key=lambda x: x["index"])
    return [item["embedding"] for item in sorted_data]


def insert_supabase(rows: list[dict]):
    """批量插入 Supabase"""
    url = f"{SUPABASE_URL}/rest/v1/documents"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    resp = requests.post(url, json=rows, headers=headers, timeout=30)
    if resp.status_code not in (200, 201):
        print(f"  ❌ Supabase insert failed: {resp.status_code} {resp.text[:200]}")
    else:
        print(f"  ✅ Inserted {len(rows)} rows")


def process_pdf(pdf_path: str):
    filename = Path(pdf_path).name
    print(f"\n📄 Processing: {filename}")

    # 1. 提取文本
    text = extract_text(pdf_path)
    if not text.strip():
        print(f"  ⚠️ No text extracted, skipping")
        return
    print(f"  Text length: {len(text)} chars")

    # 2. 切分
    chunks = split_text(text)
    print(f"  Chunks: {len(chunks)}")

    # 3. 逐批 embedding + 入库
    all_rows = []
    for i in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[i : i + BATCH_SIZE]
        print(f"  Embedding batch {i // BATCH_SIZE + 1}/{(len(chunks) + BATCH_SIZE - 1) // BATCH_SIZE}...")
        vectors = embed_batch(batch)
        for j, (content, embedding) in enumerate(zip(batch, vectors)):
            all_rows.append({
                "content": content,
                "embedding": embedding,
                "metadata": json.dumps({
                    "source": filename,
                    "chunk_index": i + j,
                    "total_chunks": len(chunks),
                    "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }),
            })
        time.sleep(0.5)  # 限速

    # 4. 插入 Supabase
    insert_supabase(all_rows)
    print(f"  Done: {filename} → {len(all_rows)} chunks")


def main():
    if len(sys.argv) < 2:
        print("Usage: python upload-pdfs.py <dir_with_pdfs>")
        sys.exit(1)

    pdf_dir = sys.argv[1]
    pdfs = sorted(Path(pdf_dir).glob("*.pdf"))
    if not pdfs:
        print(f"No PDFs found in {pdf_dir}")
        sys.exit(1)

    print(f"Found {len(pdfs)} PDFs")
    for pdf in pdfs:
        process_pdf(str(pdf))

    print("\n🎉 All done!")


if __name__ == "__main__":
    # 加载 .env.local
    env_path = Path(__file__).parent.parent / ".env.local"
    if env_path.exists():
        load_env(str(env_path))
        SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
        SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
        ZHIPU_KEY = os.environ.get("ZHIPU_API_KEY", "")

    if not all([SUPABASE_URL, SUPABASE_KEY, ZHIPU_KEY]):
        print("❌ Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ZHIPU_API_KEY")
        sys.exit(1)

    main()
