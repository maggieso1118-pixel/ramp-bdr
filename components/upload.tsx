"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, LoaderCircle } from "lucide-react";

export function UploadArea() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const active = useRef(false);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [phase, setPhase] = useState<"idle" | "uploading" | "checking">("idle");
  const [progress, setProgress] = useState(0);
  useEffect(() => () => { request.current?.abort(); }, []);

  function fail(message: string) {
    active.current = false;
    setPhase("idle");
    setError(message);
    setFilename("");
    setProgress(0);
  }

  function upload(file: File) {
    if (active.current) return;
    setError("");
    if (!file.name.toLowerCase().endsWith(".csv")) return fail("Choose a CSV file (.csv).");
    if (!file.size) return fail("This file is empty. Choose another CSV.");
    if (file.size > 200 * 1024 * 1024) return fail("This CSV exceeds the 200 MB local upload limit.");
    active.current = true;
    setFilename(file.name);
    setPhase("uploading");
    setProgress(0);
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open("POST", "/api/registry/import");
    xhr.setRequestHeader("Content-Type", "text/csv");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.responseType = "json";
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100));
    };
    xhr.upload.onload = () => { setProgress(100); setPhase("checking"); };
    xhr.onerror = () => fail("The local upload failed. Check that the preview server is running, then try again.");
    xhr.onabort = () => { if (active.current) fail("The upload was interrupted. Try again."); };
    xhr.onload = () => {
      const body = xhr.response as { error?: string; total?: number } | null;
      if (xhr.status < 200 || xhr.status >= 300) return fail(body?.error || "The CSV could not be imported. Try again.");
      if (!body?.total) return fail("No corporation records were found in this CSV.");
      request.current = null;
      router.push("/corporations?imported=1");
    };
    xhr.send(file);
  }
  return <div className="upload-wrap">
    <div className={`dropzone ${dragging ? "is-dragging" : ""} ${phase !== "idle" ? "is-loading" : ""}`}
      onDragEnter={e => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
      onDragOver={e => e.preventDefault()}
      onDragLeave={e => { e.preventDefault(); dragDepth.current--; if (!dragDepth.current) setDragging(false); }}
      onDrop={e => { e.preventDefault(); dragDepth.current = 0; setDragging(false);
        if (active.current) return;
        if (e.dataTransfer.files.length !== 1) return fail("Please choose one CSV at a time.");
        upload(e.dataTransfer.files[0]); }}>
      <input ref={input} type="file" accept=".csv,text/csv" aria-label="Choose Canadian federal corporations CSV" className="file-input" tabIndex={-1} disabled={phase !== "idle"} onChange={e => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ""; }} />
      <span className="upload-icon">{phase !== "idle" ? <LoaderCircle className="spin" size={27} /> : <Upload size={27} strokeWidth={1.5} />}</span>
      <h2>{phase === "uploading" ? "Uploading your list" : phase === "checking" ? "Preparing your book of business" : dragging ? "Drop it here" : "Ramp's Canadian GTM starts here"}</h2>
      <p>{phase === "idle" ? "Drag and drop the Canadian federal corporations CSV to explore your book of business" : filename}</p>
      {phase === "idle" ? <button type="button" className="button primary" onClick={() => input.current?.click()}>Choose CSV</button>
        : <div className="upload-progress" role="progressbar" aria-label="CSV upload" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress}%` }} /></div>}
      <span className="dropzone-note">{phase === "uploading" ? `${progress}% uploaded` : phase === "checking"
        ? "Checking government records and saving any changes. This may take a minute."
        : "Government of Canada · Active federal corporations CSV · Up to 200 MB"}</span>
    </div>
    <div role="status" aria-live="polite" className={error ? "error-message" : "sr-only"}>
      {error || (phase === "uploading" ? `Uploading ${filename}: ${progress}%` : phase === "checking" ? "Checking and importing corporation records" : "")}
    </div>
  </div>;
}
