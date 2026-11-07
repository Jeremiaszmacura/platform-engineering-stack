FROM golang:1.26-alpine AS builder

WORKDIR /app

# Download modules first so this layer is cached between code changes
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o cluster-map .

# Static, non-root runtime image
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /app/cluster-map /cluster-map

EXPOSE 8080

CMD ["/cluster-map"]
