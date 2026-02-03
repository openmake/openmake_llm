FROM pgvector/pgvector:pg16

# Install Korean locale support
RUN apt-get update && apt-get install -y locales \
    && sed -i '/ko_KR.UTF-8/s/^# //g' /etc/locale.gen \
    && locale-gen ko_KR.UTF-8 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set locale for Korean support
ENV LANG=ko_KR.UTF-8
ENV LC_ALL=ko_KR.UTF-8

# Init scripts are automatically run from /docker-entrypoint-initdb.d/
# They are copied in docker-compose via volume mount
