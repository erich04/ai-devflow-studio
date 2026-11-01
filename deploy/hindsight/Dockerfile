# DevFlow's Hindsight: the pinned upstream 1.0.0 image plus a multilingual embedding model, so
# Chinese and English memories are compared in one vector space (ADR 0030). The model files come
# from a fixed revision and must match multilingual-e5-small.sha256; the service itself runs
# offline (HF_HUB_OFFLINE in compose.yaml).
FROM ghcr.io/vectorize-io/hindsight:1.0.0@sha256:a88678c038b0e4340822b02a5efc566c56d8176b5bffa731bc433fd37f978e4c
# A Hugging Face mirror may serve the files; they still have to match the sums.
ARG HF_ENDPOINT=https://huggingface.co
ARG MODEL_REPO=intfloat/multilingual-e5-small
ARG MODEL_REVISION=614241f622f53c4eeff9890bdc4f31cfecc418b3
LABEL dev.devflow.hindsight.embedding-model="${MODEL_REPO}@${MODEL_REVISION}"
RUN mkdir -p /home/hindsight/models/multilingual-e5-small
COPY --chown=hindsight:hindsight multilingual-e5-small.sha256 /home/hindsight/models/multilingual-e5-small/SHA256SUMS
RUN cd /home/hindsight/models/multilingual-e5-small \
 && python -c "import sys; from huggingface_hub import hf_hub_download; [hf_hub_download(sys.argv[1], line.split()[1], revision=sys.argv[2], local_dir='.') for line in open('SHA256SUMS') if line.strip()]" "$MODEL_REPO" "$MODEL_REVISION" \
 && sha256sum --check --strict SHA256SUMS \
 && rm -rf .cache
