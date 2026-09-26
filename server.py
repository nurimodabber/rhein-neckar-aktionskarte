#!/usr/bin/env python3
import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8080

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))

try:
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        print(f"Rhein-Neckar Cluster Map Server läuft auf http://localhost:{PORT}")
        print("Drücke Strg+C zum Beenden.")
        # Try to open in default browser
        webbrowser.open(f"http://localhost:{PORT}")
        httpd.serve_forever()
except OSError as e:
    # Port might be in use, try 8081
    PORT = 8081
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        print(f"Rhein-Neckar Cluster Map Server läuft auf http://localhost:{PORT}")
        webbrowser.open(f"http://localhost:{PORT}")
        httpd.serve_forever()
