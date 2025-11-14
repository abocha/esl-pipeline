import React, { useState, useEffect } from 'react';
import { createJob } from '../utils/api';
import { useAuth } from '../context/AuthContext';

type JobFormState = {
  md: string;
  preset: string;
  withTts: boolean;
  upload: string;
  uploadStatus: 'idle' | 'uploading' | 'uploaded' | 'error';
  uploadError?: string | null;
};

type JobFormProps = {
  onJobCreated(jobId: string): void;
};

/**
 * Minimal form for POST /jobs.
 *
 * Fields map directly to SubmitJobRequest:
 * - md (required)
 * - preset? (optional)
 * - withTts? (optional)
 * - upload? (optional)
 *
 * Uses the shared createJob() helper for type-safe interaction
 * with the batch-backend. Any backend error is surfaced inline.
 *
 * File upload flow:
 * - User selects a local .md file.
 * - We POST it to /uploads via uploadMarkdown() to get an md identifier.
 * - That identifier is stored in form.md and sent to POST /jobs.
 */
export const JobForm: React.FC<JobFormProps> = ({ onJobCreated }) => {
  const { isAuthenticated, user } = useAuth();
  const [form, setForm] = useState<JobFormState>({
    md: '',
    preset: 'b1-default',
    withTts: true,
    upload: 's3',
    uploadStatus: 'idle',
    uploadError: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  const [, setUserFiles] = useState<any[]>([]);
  const [quotaInfo] = useState<{ used: number; limit: number } | null>(null);

  // Load user files and quota info when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadUserData();
    }
  }, [isAuthenticated]);

  const loadUserData = async () => {
    try {
      // Load user files
      const { getUserFiles } = await import('../utils/api');
      const files = await getUserFiles();
      setUserFiles(files);

      // Load quota info (if available from API)
      // const quota = await getUserQuota();
      // setQuotaInfo(quota);
    } catch (err: any) {
      console.error('Failed to load user data:', err);
    }
  };

  const handleChange = (field: keyof JobFormState, value: string | boolean) => {
    setForm(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Authentication check
    if (!isAuthenticated) {
      setError('You must be logged in to submit jobs.');
      return;
    }

    if (form.uploadStatus === 'uploading') {
      setError('Please wait for the upload to finish before submitting.');
      return;
    }

    if (!form.md.trim()) {
      setError(
        'md is required. Upload a markdown file or provide a valid backend-visible identifier.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const { jobId } = await createJob({
        md: form.md.trim(),
        preset: form.preset.trim() || undefined,
        withTts: form.withTts,
        upload: form.upload.trim() || undefined,
      });

      setLastJobId(jobId);
      onJobCreated(jobId);

      // Refresh user data after job submission (might update quota)
      loadUserData();
    } catch (err: any) {
      // Handle authentication errors
      if (err.message?.includes('401') || err.message?.includes('unauthorized')) {
        setError('Your session has expired. Please login again.');
      } else {
        // createJob already throws a descriptive error message
        setError(err.message || 'Failed to submit job.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        border: '1px solid #ddd',
        padding: '12px',
        borderRadius: '6px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <h2
        style={{
          fontSize: '16px',
          margin: 0,
          fontWeight: 600,
        }}
      >
        New Batch Job
      </h2>

      {/* User info and quota display */}
      {isAuthenticated && user && (
        <div
          style={{
            padding: '8px',
            backgroundColor: '#f8f9fa',
            borderRadius: '4px',
            fontSize: '13px',
            marginBottom: '8px',
          }}
        >
          <div>
            Logged in as: <strong>{user.email}</strong> ({user.role})
          </div>
          {quotaInfo && (
            <div style={{ marginTop: '4px' }}>
              Upload quota: {quotaInfo.used} / {quotaInfo.limit} files used
            </div>
          )}
        </div>
      )}

      {/* Authentication warning */}
      {!isAuthenticated && (
        <div
          style={{
            padding: '8px',
            backgroundColor: '#fff3cd',
            border: '1px solid #ffeaa7',
            borderRadius: '4px',
            fontSize: '13px',
            marginBottom: '8px',
            color: '#856404',
          }}
        >
          You must be logged in to submit jobs. Please login above.
        </div>
      )}

      <label style={{ fontSize: '13px' }}>
        Upload markdown (.md)
        <input
          type="file"
          accept=".md,text/markdown"
          onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) {
              return;
            }

            setForm(prev => ({
              ...prev,
              uploadStatus: 'uploading',
              uploadError: null,
            }));
            setError(null);

            // Check authentication before upload
            if (!isAuthenticated) {
              const message = 'You must be logged in to upload files.';
              setForm(prev => ({
                ...prev,
                uploadStatus: 'error',
                uploadError: message,
              }));
              setError(message);
              return;
            }

            try {
              const { uploadMarkdown } = await import('../utils/api');
              const res = await uploadMarkdown(file);

              setForm(prev => ({
                ...prev,
                md: res.md,
                uploadStatus: 'uploaded',
                uploadError: null,
              }));

              // Refresh user files after successful upload
              loadUserData();
            } catch (err: any) {
              let message = err?.message || 'Failed to upload markdown file. Please try again.';

              // Handle authentication errors
              if (err.message?.includes('401') || err.message?.includes('unauthorized')) {
                message = 'Your session has expired. Please login again.';
              }

              setForm(prev => ({
                ...prev,
                uploadStatus: 'error',
                uploadError: message,
              }));
              setError(message);
            }
          }}
          style={{
            width: '100%',
            marginTop: '4px',
            padding: '4px 0',
            fontSize: '13px',
          }}
        />
      </label>

      <label style={{ fontSize: '13px' }}>
        md (backend path or identifier)
        <input
          type="text"
          value={form.md}
          onChange={e => handleChange('md', e.target.value)}
          placeholder="uploads/<id>.md or another backend-visible path"
          style={{
            width: '100%',
            marginTop: '4px',
            padding: '6px 8px',
            fontSize: '13px',
            borderRadius: '4px',
            border: '1px solid #ccc',
          }}
        />
        <div
          style={{
            marginTop: '2px',
            fontSize: '11px',
            color:
              form.uploadStatus === 'uploaded'
                ? '#166534'
                : form.uploadStatus === 'error'
                  ? '#991b1b'
                  : '#6b7280',
          }}
        >
          {form.uploadStatus === 'uploading' && 'Uploading markdown...'}
          {form.uploadStatus === 'uploaded' && 'Upload complete. Using returned identifier as md.'}
          {form.uploadStatus === 'error' && form.uploadError}
          {form.uploadStatus === 'idle' &&
            (isAuthenticated
              ? 'You can paste an existing backend path or use the uploader above.'
              : 'Login required to upload files. You can paste existing paths if you have them.')}
        </div>
      </label>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '8px',
          fontSize: '13px',
        }}
      >
        <label>
          preset (optional)
          <input
            type="text"
            value={form.preset}
            onChange={e => handleChange('preset', e.target.value)}
            placeholder="b1-default"
            style={{
              width: '100%',
              marginTop: '4px',
              padding: '6px 8px',
              fontSize: '13px',
              borderRadius: '4px',
              border: '1px solid #ccc',
            }}
          />
        </label>

        <label>
          upload (optional)
          <input
            type="text"
            value={form.upload}
            onChange={e => handleChange('upload', e.target.value)}
            placeholder="s3"
            style={{
              width: '100%',
              marginTop: '4px',
              padding: '6px 8px',
              fontSize: '13px',
              borderRadius: '4px',
              border: '1px solid #ccc',
            }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '18px',
          }}
        >
          <input
            type="checkbox"
            checked={form.withTts}
            onChange={e => handleChange('withTts', e.target.checked)}
          />
          withTts
        </label>
      </div>

      {error && (
        <div
          style={{
            marginTop: '4px',
            padding: '6px 8px',
            backgroundColor: '#fff4f4',
            borderRadius: '4px',
            border: '1px solid #f2c2c2',
            color: '#a40000',
            fontSize: '12px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </div>
      )}

      {lastJobId && (
        <div
          style={{
            marginTop: '4px',
            padding: '6px 8px',
            backgroundColor: '#f5f9ff',
            borderRadius: '4px',
            border: '1px solid #c7ddff',
            color: '#1a4aa8',
            fontSize: '12px',
            wordBreak: 'break-all',
          }}
        >
          Last submitted jobId: {lastJobId}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          marginTop: '4px',
          padding: '8px 10px',
          fontSize: '13px',
          borderRadius: '4px',
          border: 'none',
          backgroundColor: submitting ? '#999' : '#2563eb',
          color: 'white',
          cursor: submitting ? 'default' : 'pointer',
          alignSelf: 'flex-start',
        }}
      >
        {submitting ? 'Submitting...' : 'Submit Job'}
      </button>
    </form>
  );
};
