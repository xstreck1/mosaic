from http.server import ThreadingHTTPServer
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import Handler


class StaticServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_static_assets_are_served_without_image_libraries(self):
        for path in ("/", "/app.js", "/styles.css", "/rasterizer.js", "/raster-worker.js", "/browser-rasterizer.js", "/editor.js", "/crop.js", "/palette-reference.png"):
            with self.subTest(path=path), urlopen(self.base + path) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertTrue(response.read())

    def test_upload_and_export_apis_are_absent(self):
        for path in ("/api/rasterize", "/api/export"):
            with self.subTest(path=path), self.assertRaises(HTTPError) as context:
                urlopen(Request(self.base + path, data=b"not uploaded"))
            self.assertEqual(context.exception.code, 501)

    def test_server_only_exposes_the_static_folder(self):
        for path in ("/server.py", "/../server.py", "/README.md"):
            with self.subTest(path=path), self.assertRaises(HTTPError) as context:
                urlopen(self.base + path)
            self.assertEqual(context.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
