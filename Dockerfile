# 1. BASE IMAGE: Must match the @cloudflare/sandbox version in package.json (0.10.2)
# Using the lean default image (JavaScript/TypeScript optimized)
FROM docker.io/cloudflare/sandbox:0.10.2

# 2. ENVIRONMENT: Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# 3. SYSTEM PACKAGES: Install essential SOC & Cybersecurity Analyst tools
# We use --no-install-recommends to keep the image lean and minimize the attack surface.
RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap \
    curl \
    netcat-openbsd \
    jq \
    dnsutils \
    iputils-ping \
    whois \
    traceroute \
    git \
    unzip \
    ca-certificates \
    # 4. CLEANUP: Remove apt cache to dramatically reduce final image size
    && rm -rf /var/lib/apt/lists/*

# 5. WORKSPACE: Set standard isolated working directory for the operator
WORKDIR /workspace

# 6. PORT: Document the default Cloudflare Sandbox HTTP API port
EXPOSE 8080
