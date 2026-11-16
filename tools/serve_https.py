"""
Startet einen HTTPS-Server für web/ im lokalen Netz, damit die Handykamera funktioniert.
Erstellt beim ersten Start ein selbstsigniertes Zertifikat (tools/cert/).

    .venv\\Scripts\\python tools\\serve_https.py            (Port 8443)

Auf dem Handy (gleiches WLAN): https://<PC-IP>:8443 öffnen und die Zertifikatswarnung bestätigen.
"""
import datetime
import functools
import http.server
import ipaddress
import socket
import ssl
import sys
import threading
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
CERT_DIR = Path(__file__).resolve().parent / "cert"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
HTTP_PORT = 8080


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # kein echter Verkehr, nur Routing-Abfrage
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip):
    CERT_DIR.mkdir(exist_ok=True)
    crt, key = CERT_DIR / "cert.pem", CERT_DIR / "key.pem"
    if crt.exists() and key.exists() and (CERT_DIR / "ip.txt").read_text() == ip:
        return crt, key
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "FormCoach Dev")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name).issuer_name(name)
        .public_key(k.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName([
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.ip_address(ip)),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
        ]), critical=False)
        .sign(k, hashes.SHA256())
    )
    crt.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key.write_bytes(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    (CERT_DIR / "ip.txt").write_text(ip)
    return crt, key


class HTTPSServer(http.server.ThreadingHTTPServer):
    """TLS-Handshake pro Verbindung im eigenen Thread, mit Logging jedes Versuchs."""
    ssl_ctx = None

    def finish_request(self, request, client_address):
        print(f"[HTTPS] Verbindung von {client_address[0]}", flush=True)
        try:
            request = self.ssl_ctx.wrap_socket(request, server_side=True)
        except (ssl.SSLError, OSError) as e:
            print(f"[HTTPS] TLS-Handshake mit {client_address[0]} fehlgeschlagen: {e}", flush=True)
            return
        super().finish_request(request, client_address)


def info_server(ip, http_port):
    """Einfache HTTP-Testseite: lädt sie am Handy, ist das Netzwerk in Ordnung."""
    url = f"https://{ip}:{PORT}"

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            print(f"[HTTP]  Testseite aufgerufen von {self.client_address[0]}", flush=True)
            body = f"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<body style="font:18px system-ui;background:#0b1220;color:#e6edf7;padding:24px">
<h1>✓ Verbindung zum PC klappt</h1><p>Das Netzwerk ist in Ordnung. Jetzt zur App (Zertifikatswarnung bestätigen):</p>
<p><a style="color:#38bdf8;font-size:22px" href="{url}">{url}</a></p></body>""".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("0.0.0.0", http_port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()


def main():
    ip = lan_ip()
    crt, key = ensure_cert(ip)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(crt, key)
    HTTPSServer.ssl_ctx = ctx
    httpd = HTTPSServer(("0.0.0.0", PORT), handler)
    info_server(ip, HTTP_PORT)
    print(f"FormCoach läuft:  https://{ip}:{PORT}   (Handy im selben WLAN)", flush=True)
    print(f"Netzwerk-Test:    http://{ip}:{HTTP_PORT}", flush=True)
    print(f"Am PC:            https://localhost:{PORT}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
