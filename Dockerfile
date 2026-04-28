FROM eclipse-temurin:21-jdk AS build

WORKDIR /build

COPY pom.xml .
COPY actiondock-core/pom.xml actiondock-core/
COPY actiondock-plugin-api/pom.xml actiondock-plugin-api/
COPY actiondock-storage-jpa/pom.xml actiondock-storage-jpa/
COPY actiondock-app-support/pom.xml actiondock-app-support/
COPY actiondock-app-spring/pom.xml actiondock-app-spring/
COPY actiondock-plugin-template/pom.xml actiondock-plugin-template/

RUN mvn dependency:go-offline -B

COPY . .

RUN mvn package -DskipTests -B \
    && mv actiondock-app-spring/target/*.jar app.jar

FROM eclipse-temurin:21-jre

RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN groupadd -r actiondock && useradd -r -g actiondock -d /app actiondock
USER actiondock

COPY --from=build /build/app.jar app.jar

ENV APP_HOME_DIR=/app/data
ENV JAVA_OPTS="-Xmx256m -Xms128m"

EXPOSE 5177

ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS} -jar app.jar"]
