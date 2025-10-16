Write-Host "Building OPTIMIZED scikit-learn layer..." -ForegroundColor Green

docker run --rm -v ${PWD}:/workspace -w /workspace python:3.12-slim bash -c @"
    mkdir -p python/lib/python3.12/site-packages && \
    pip install --platform manylinux2014_x86_64 \
        --target python/lib/python3.12/site-packages \
        --implementation cp \
        --python-version 3.12 \
        --only-binary=:all: \
        --upgrade \
        --no-cache-dir \
        scikit-learn==1.3.2 \
        numpy==1.26.0 \
        scipy==1.11.4 && \
    cd python/lib/python3.12/site-packages && \
    find . -type d -name 'tests' -exec rm -rf {} + 2>/dev/null || true && \
    find . -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true && \
    find . -type f -name '*.pyc' -delete && \
    find . -type f -name '*.pyo' -delete && \
    find . -type f -name '*.so' -exec strip {} + 2>/dev/null || true && \
    cd /workspace && \
    apt-get update && apt-get install -y zip && \
    zip -r -9 sklearn_layer_optimized.zip python && \
    rm -rf python
"@

Write-Host "Building NLTK layer..." -ForegroundColor Green

docker run --rm -v ${PWD}:/workspace -w /workspace python:3.12-slim bash -c @"
    mkdir -p python/lib/python3.12/site-packages && \
    pip install --platform manylinux2014_x86_64 \
        --target python/lib/python3.12/site-packages \
        --implementation cp \
        --python-version 3.12 \
        --only-binary=:all: \
        --upgrade \
        nltk==3.8.1 && \
    cd python/lib/python3.12/site-packages && \
    find . -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true && \
    find . -type f -name '*.pyc' -delete && \
    cd /workspace && \
    apt-get update && apt-get install -y zip && \
    zip -r nltk_layer.zip python && \
    rm -rf python
"@

Write-Host ""
Write-Host "✅ Optimized layers built!" -ForegroundColor Green
Write-Host "Check size: ls sklearn_layer_optimized.zip, nltk_layer.zip" -ForegroundColor Cyan