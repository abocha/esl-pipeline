import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SplitEditor } from './SplitEditor';
import { ValidationPanel } from './ValidationPanel';

// Mock CodeMirror and Preview to avoid complex DOM
vi.mock('./MarkdownEditor', () => ({
    MarkdownEditor: ({ value, onChange }: { value: string; onChange: (val: string) => void }) => (
        <textarea
            data-testid="markdown-editor"
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));

vi.mock('./MarkdownPreview', () => ({
    MarkdownPreview: ({ content }: { content: string }) => (
        <div data-testid="markdown-preview">{content}</div>
    ),
}));

describe('SplitEditor', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders editor and preview in split mode by default', () => {
        render(
            <SplitEditor
                value="# Hello"
                onChange={() => { }}
            />
        );

        expect(screen.getByTestId('markdown-editor')).not.toBeNull();
        expect(screen.getByTestId('markdown-preview')).not.toBeNull();
    });

    it('toggles views', () => {
        render(
            <SplitEditor
                value="# Hello"
                onChange={() => { }}
            />
        );

        // Switch to Edit only
        const editBtn = screen.getByRole('button', { name: 'Editor' });
        fireEvent.click(editBtn);
        expect(screen.getByTestId('split-panels').className).toContain('editor');

        // Switch to Preview only
        const previewBtn = screen.getByRole('button', { name: 'Preview' });
        fireEvent.click(previewBtn);
        expect(screen.getByTestId('split-panels').className).toContain('preview');
    });
});

describe('ValidationPanel', () => {
    it('renders nothing when valid', () => {
        render(
            <ValidationPanel
                validation={{ ok: true, errors: [], warnings: [] }}
                error={null}
                isValidating={false}
                strict={false}
                onToggleStrict={() => { }}
            />
        );
        expect(screen.getByText('Looks good')).not.toBeNull();
    });

    it('renders errors and warnings', () => {
        render(
            <ValidationPanel
                validation={{
                    ok: false,
                    errors: ['Error 1'],
                    warnings: ['Warning 1']
                }}
                error={null}
                isValidating={false}
                strict={false}
                onToggleStrict={() => { }}
            />
        );

        expect(screen.getByText('Error 1')).not.toBeNull();
        expect(screen.getByText('Warning 1')).not.toBeNull();
    });
});
