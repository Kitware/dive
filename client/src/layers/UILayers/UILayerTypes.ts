export interface ToolTipWidgetData {
    type: string;
    confidence: number;
    trackId: number;
    /** Suppression type name when the detection is attribute-flagged as suppressed. */
    suppressed?: string;
}
