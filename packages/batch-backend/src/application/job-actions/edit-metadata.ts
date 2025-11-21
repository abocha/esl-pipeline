// packages/batch-backend/src/application/job-actions/edit-metadata.ts
//
// Handler for job metadata editing action (stub implementation)

import type { EditMetadataAction, JobActionResult } from '../../domain/job-actions';
import { JobActionType } from '../../domain/job-actions';
import { getJobById } from '../../domain/job-repository';

/**
 * Edit job metadata without rerunning the job
 * 
 * @param jobId - ID of the job to edit
 * @param action - Edit metadata action with new values
 * @returns Action result indicating success/failure
 * 
 * TODO: Implement actual metadata editing:
 * 1. Validate new metadata values
 * 2. Update job record in database
 * 3. Optionally update manifest file if it exists
 * 4. Emit job_state_changed event
 * 5. Return success with updated job data
 */
export async function editMetadata(
    jobId: string,
    _action: EditMetadataAction
): Promise<JobActionResult> {
    // Verify job exists
    const job = await getJobById(jobId);
    if (!job) {
        return {
            success: false,
            message: 'Job not found',
            jobId,
            actionType: JobActionType.EDIT_METADATA,
            timestamp: new Date(),
            error: 'not_found',
        };
    }

    // TODO: Implement metadata editing
    // For now, return not_implemented stub response
    return {
        success: false,
        message: 'Metadata editing not yet implemented',
        jobId,
        actionType: JobActionType.EDIT_METADATA,
        timestamp: new Date(),
        error: 'not_implemented',
    };
}
