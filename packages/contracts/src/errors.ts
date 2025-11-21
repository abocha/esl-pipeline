export class PipelineError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = this.constructor.name;
    }
}

export class ConfigurationError extends PipelineError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}

export class InfrastructureError extends PipelineError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}

export class FfmpegNotFoundError extends InfrastructureError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}

export class ValidationError extends PipelineError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}

export class ManifestError extends PipelineError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
    }
}
