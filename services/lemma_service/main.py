import os
from typing import List, Optional

import spacy
from fastapi import FastAPI
from pydantic import BaseModel, Field


class LemmatizeRequest(BaseModel):
    text: str = Field(min_length=0, max_length=20000)


class TokenOut(BaseModel):
    text: str
    lemma: str
    pos: str
    start: int
    end: int


class LemmatizeResponse(BaseModel):
    language: str
    model: str
    tokens: List[TokenOut]


def load_nlp():
    model = os.getenv("SPACY_MODEL", "en_core_web_sm")
    # We don't need NER for lemmatization; keep it light and fast.
    nlp = spacy.load(model, exclude=["ner"])
    return nlp, model


NLP, MODEL_NAME = load_nlp()

app = FastAPI(title="Duma Lemma Service", version="0.1.0")


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME}


@app.post("/lemmatize", response_model=LemmatizeResponse)
def lemmatize(req: LemmatizeRequest):
    text = req.text or ""
    doc = NLP(text)
    tokens: List[TokenOut] = []
    for t in doc:
        tokens.append(
            TokenOut(
                text=t.text,
                lemma=t.lemma_,
                pos=t.pos_,
                start=int(t.idx),
                end=int(t.idx + len(t.text)),
            )
        )
    return LemmatizeResponse(language=str(doc.lang_), model=MODEL_NAME, tokens=tokens)

