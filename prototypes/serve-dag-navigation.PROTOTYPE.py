"""THROWAWAY. Serve only the local prototypes directory on loopback."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

if __name__ == "__main__":
    directory = str(Path(__file__).resolve().parent)
    server = ThreadingHTTPServer(("127.0.0.1", 8875), partial(SimpleHTTPRequestHandler, directory=directory))
    print("DAG prototype: http://127.0.0.1:8875/selection-hierarchy.PROTOTYPE.html?variant=A", flush=True)
    print("Explicit demo: http://127.0.0.1:8875/selection-hierarchy.PROTOTYPE.html?variant=A&fixture=dag", flush=True)
    server.serve_forever()
