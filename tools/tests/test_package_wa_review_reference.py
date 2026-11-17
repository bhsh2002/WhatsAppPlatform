import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "package_wa_review_reference.py"
SPEC = importlib.util.spec_from_file_location("wa_review_packager", SCRIPT)
packager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packager)


class ReviewReferenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wa-selective-reference-test-")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name).resolve()
        self.repository = self.directory / "repository"
        self.repository.mkdir()
        self.output = self.directory / "review"
        self.git("init", "-q")
        (self.repository / "app.js").write_text("export const value = 1;\n")
        self.git("add", "--", "app.js")
        self.git("-c", "user.name=Synthetic test", "-c", "user.email=synthetic@example.invalid",
                 "commit", "-q", "-m", "synthetic fixture baseline")
        (self.repository / "app.js").write_text("export const value = 2;\n")
        (self.repository / "new.js").write_text("export const added = true;\n")
        (self.repository / "unrelated.txt").write_text("Preserve unrelated synthetic work.\n")
        self.contract = self.directory / "operation.openapi.json"
        self.contract.write_text(json.dumps({"openapi": "3.1.0", "paths": {}, "info": {"title": "Synthetic", "version": "1.0"},
                                             "x-contract-lifecycle": "synthetic_local_not_deployed"}))
        self.references = [{"id": "synthetic-operation-v1", "version": "1.0", "path": str(self.contract),
                            "expected_sha256": packager.sha256(self.contract.read_bytes())}]

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repository, check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout

    def test_exact_overlay_is_deterministic_and_preserves_worktree_and_unrelated_content(self):
        before = self.git("status", "--porcelain=v1")
        first = packager.package(self.repository, ["app.js", "new.js"], self.references, self.output)
        second = packager.package(self.repository, ["new.js", "app.js"], self.references, self.output)
        self.assertEqual(first, second)
        self.assertEqual(self.git("status", "--porcelain=v1"), before)
        self.assertEqual((self.repository / "unrelated.txt").read_text(), "Preserve unrelated synthetic work.\n")
        data = (self.output / first["archive"]).read_bytes()
        self.assertEqual(packager.sha256(data), first["sha256"])
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            names = archive.getnames()
            self.assertIn("source/app.js", names)
            self.assertIn("source/new.js", names)
            self.assertNotIn("source/unrelated.txt", names)
            manifest = json.load(archive.extractfile("review-manifest.json"))
            self.assertEqual(manifest["excluded_dirty_paths"], ["unrelated.txt"])
            self.assertFalse(manifest["baseline_head_contains_worktree_changes"])
            self.assertFalse(manifest["deployment_authorized"])
            self.assertEqual(archive.extractfile("source/app.js").read(), (self.repository / "app.js").read_bytes())
            snapshot = manifest["official_contracts"][0]["snapshot_member"]
            self.assertEqual(manifest["official_contracts"][0]["official_document_lifecycle"], "synthetic_local_not_deployed")
            self.assertEqual(archive.extractfile(snapshot).read(), self.contract.read_bytes())

    def test_runtime_generated_secret_and_symlink_paths_are_refused(self):
        for name in [".env", "server/.ENV.local", "state.db", "private.key", "dist/app.js", "node_modules/a.js", "backup.tar.gz", "../escape", "/absolute"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                packager.relative_source(name)
        outside = self.directory / "outside.js"
        outside.write_text("not part of source\n")
        (self.repository / "linked.js").symlink_to(outside)
        with self.assertRaises(ValueError):
            packager.package(self.repository, ["linked.js"], [], self.output)
        (self.repository / ".env.example").write_text("SAVANA_CONNECT_PLATFORM_TOKEN=not-an-allowed-example-value\n")
        with self.assertRaises(ValueError):
            packager.package(self.repository, [".env.example"], [], self.output)

    def test_changed_contract_hash_and_output_inside_repository_are_refused(self):
        self.contract.write_text('{"openapi":"3.1.0","paths":{"/changed":{}}}')
        with self.assertRaises(ValueError):
            packager.package(self.repository, ["app.js"], self.references, self.output)
        with self.assertRaises(ValueError):
            packager.package(self.repository, ["app.js"], [], self.repository / "review")

    def test_clean_baseline_files_cannot_turn_the_overlay_into_a_project_backup(self):
        (self.repository / "app.js").write_text("export const value = 1;\n")
        with self.assertRaises(ValueError):
            packager.package(self.repository, ["app.js"], [], self.output)

    def test_contract_reference_needs_the_published_fingerprint_and_matching_version(self):
        for reference in [{**self.references[0], "expected_sha256": None}, {**self.references[0], "version": "2.0"}]:
            with self.subTest(reference=reference), self.assertRaises(ValueError):
                packager.package(self.repository, ["app.js"], [reference], self.output)

    def test_deletions_are_explicit_and_never_extract_or_apply_automatically(self):
        (self.repository / "app.js").unlink()
        result = packager.package(self.repository, ["app.js"], [], self.output)
        with tarfile.open(self.output / result["archive"], mode="r:gz") as archive:
            manifest = json.load(archive.extractfile("review-manifest.json"))
            self.assertEqual(manifest["included_sources"][0]["state"], "deleted")
            self.assertNotIn("source/app.js", archive.getnames())
            self.assertIn(b"deleted file", archive.extractfile("selected-tracked-changes.patch").read())
        self.assertFalse((self.repository / "app.js").exists())


if __name__ == "__main__":
    unittest.main()
