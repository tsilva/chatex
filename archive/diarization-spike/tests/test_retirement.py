"""Prove the archived server cannot import dependencies or reach credentials."""

import os
import unittest
from pathlib import Path
from unittest.mock import patch


class RetirementTests(unittest.TestCase):
    def test_direct_and_asgi_launches_are_blocked(self):
        path = Path(__file__).resolve().parents[1] / "app.py"
        code = compile(path.read_text(), str(path), "exec")
        for module_name in ("__main__", "app"):
            for fake_model in ("0", "1"):
                with self.subTest(module=module_name, fake_model=fake_model):
                    with patch.dict(os.environ, {"DIARIZATION_FAKE_MODEL": fake_model}):
                        with patch(
                            "builtins.__import__",
                            side_effect=AssertionError("Retired server imported a dependency"),
                        ):
                            with self.assertRaisesRegex(RuntimeError, "retired and cannot be launched"):
                                exec(code, {"__name__": module_name})


if __name__ == "__main__":
    unittest.main()
