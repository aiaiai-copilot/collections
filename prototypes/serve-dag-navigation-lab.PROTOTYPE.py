"""THROWAWAY. Serve only the isolated DAG navigator laboratory on loopback."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

if __name__ == "__main__":
    directory = str(Path(__file__).resolve().parent)
    server = ThreadingHTTPServer(
        ("127.0.0.1", 8876),
        partial(SimpleHTTPRequestHandler, directory=directory),
    )
    print(
        "DAG navigator lab: "
        "http://127.0.0.1:8876/dag-navigation-lab.PROTOTYPE.html?scenario=roots",
        flush=True,
    )
    server.serve_forever()
