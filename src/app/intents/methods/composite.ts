import logger from '../../utils/logger';
import { IToolIntentDetector, ToolIntentResult } from '../intent.dto';

/**
 * Configuration for individual detectors in the composite.
 */
interface DetectorConfig {
  detector: IToolIntentDetector;
  weight: number;
  name?: string;
}

/**
 * Composite implementation of tool intent detection that orchestrates multiple detection strategies.
 * Uses the composite pattern to combine results from multiple detectors with weighted scoring.
 */
export class CompositeIntentDetector implements IToolIntentDetector {
  private readonly detectorConfigs: DetectorConfig[];

  /**
   * Creates a new composite intent detector.
   * @param detectors - Array of detector implementations to orchestrate
   * @param weights - Optional array of weights for each detector (defaults to equal weights)
   */
  constructor(detectors: IToolIntentDetector[], weights?: number[]) {
    if (!detectors || detectors.length === 0) {
      throw new Error('CompositeIntentDetector requires at least one detector');
    }

    // Default to equal weights if not provided
    const defaultWeights = weights || new Array(detectors.length).fill(1.0);

    if (defaultWeights.length !== detectors.length) {
      throw new Error('Number of weights must match number of detectors');
    }

    // Normalize weights to sum to 1.0
    const weightSum = defaultWeights.reduce((sum, weight) => sum + weight, 0);
    const normalizedWeights = defaultWeights.map(weight => weight / weightSum);

    this.detectorConfigs = detectors.map((detector, index) => ({
      detector,
      weight: normalizedWeights[index]!,
      name: detector.constructor.name || `Detector${index}`,
    }));

    logger.debug(
      `[CompositeIntentDetector] Initialized with ${this.detectorConfigs.length} detectors:`,
      this.detectorConfigs.map(config => ({
        name: config.name,
        weight: config.weight.toFixed(3),
      }))
    );
  }

  /**
   * Analyzes a transcript using all configured detectors and combines their results.
   * Runs detectors in parallel for performance and aggregates results using weighted scoring.
   */
  async detectToolIntent(transcript: string): Promise<ToolIntentResult> {
    if (!transcript || transcript.trim().length === 0) {
      logger.debug('[CompositeIntentDetector] Empty transcript provided');
      return {
        requiresTools: false,
        detectedTools: [],
        confidence: 0,
      };
    }

    logger.debug(
      `[CompositeIntentDetector] Running ${this.detectorConfigs.length} detectors for transcript:`,
      transcript.substring(0, 100) + (transcript.length > 100 ? '...' : '')
    );

    // Run all detectors in parallel with error handling
    const detectorPromises = this.detectorConfigs.map(async config => {
      try {
        const startTime = Date.now();
        const result = await config.detector.detectToolIntent(transcript);
        const duration = Date.now() - startTime;

        logger.debug(
          `[CompositeIntentDetector] ${config.name} completed in ${duration}ms:`,
          {
            requiresTools: result.requiresTools,
            detectedTools: result.detectedTools,
            confidence: result.confidence?.toFixed(3),
            weight: config.weight.toFixed(3),
          }
        );

        return {
          config,
          result,
          success: true,
        };
      } catch (error) {
        console.error(
          `[CompositeIntentDetector] ${config.name} failed:`,
          error instanceof Error ? error.message : String(error)
        );

        // Return a default result for failed detectors
        return {
          config,
          result: {
            requiresTools: false,
            detectedTools: [],
            confidence: 0,
          },
          success: false,
        };
      }
    });

    const detectorResults = await Promise.all(detectorPromises);

    // Filter successful results for aggregation
    const successfulResults = detectorResults.filter(result => result.success);

    if (successfulResults.length === 0) {
      console.error('[CompositeIntentDetector] All detectors failed');
      return {
        requiresTools: false,
        detectedTools: [],
        confidence: 0,
      };
    }

    // Aggregate results using weighted scoring
    const aggregatedResult = this.aggregateResults(successfulResults);

    logger.debug(
      `[CompositeIntentDetector] Aggregated result from ${successfulResults.length}/${detectorResults.length} successful detectors:`,
      {
        requiresTools: aggregatedResult.requiresTools,
        detectedTools: aggregatedResult.detectedTools,
        confidence: aggregatedResult.confidence?.toFixed(3),
        transcript:
          transcript.substring(0, 100) + (transcript.length > 100 ? '...' : ''),
      }
    );

    return aggregatedResult;
  }

  /**
   * Aggregates results from multiple detectors using weighted scoring.
   */
  private aggregateResults(
    detectorResults: Array<{
      config: DetectorConfig;
      result: ToolIntentResult;
      success: boolean;
    }>
  ): ToolIntentResult {
    // Collect all detected tools (union of all detectors)
    const allDetectedTools = new Set<string>();
    let weightedConfidenceSum = 0;
    let totalWeight = 0;
    let hasAnyToolDetection = false;

    for (const { config, result } of detectorResults) {
      // Add detected tools to the union
      if (result.detectedTools && result.detectedTools.length > 0) {
        result.detectedTools.forEach(tool => allDetectedTools.add(tool));
        hasAnyToolDetection = true;
      }

      // Calculate weighted confidence
      if (result.confidence !== undefined) {
        weightedConfidenceSum += result.confidence * config.weight;
        totalWeight += config.weight;
      }
    }

    // Calculate final confidence as weighted average
    const finalConfidence =
      totalWeight > 0 ? weightedConfidenceSum / totalWeight : 0;

    // Determine if tools are required based on any detector finding tools
    const requiresTools = hasAnyToolDetection;
    const detectedTools = Array.from(allDetectedTools);

    return {
      requiresTools,
      detectedTools: requiresTools ? detectedTools : undefined,
      confidence: requiresTools ? finalConfidence : undefined,
    };
  }

  /**
   * Get information about all configured detectors.
   * Useful for debugging and monitoring.
   */
  getDetectorInfo(): Array<{ name: string; weight: number }> {
    return this.detectorConfigs.map(config => ({
      name: config.name || 'Unknown',
      weight: config.weight,
    }));
  }

  /**
   * Update the weight of a specific detector by name.
   * Weights are automatically normalized after update.
   */
  updateDetectorWeight(detectorName: string, newWeight: number): boolean {
    const configToUpdate = this.detectorConfigs.find(
      config => config.name === detectorName
    );

    if (!configToUpdate) {
      console.warn(
        `[CompositeIntentDetector] Detector '${detectorName}' not found`
      );
      return false;
    }

    // Update weight
    configToUpdate.weight = newWeight;

    // Renormalize all weights
    const weightSum = this.detectorConfigs.reduce(
      (sum, config) => sum + config.weight,
      0
    );

    this.detectorConfigs.forEach(config => {
      config.weight = config.weight / weightSum;
    });

    logger.debug(
      `[CompositeIntentDetector] Updated weight for '${detectorName}' and renormalized:`,
      this.detectorConfigs.map(config => ({
        name: config.name,
        weight: config.weight.toFixed(3),
      }))
    );

    return true;
  }

  /**
   * Add a new detector to the composite at runtime.
   * All weights are renormalized after addition.
   */
  addDetector(
    detector: IToolIntentDetector,
    weight: number = 1.0,
    name?: string
  ): void {
    const detectorName =
      name ||
      detector.constructor.name ||
      `Detector${this.detectorConfigs.length}`;

    this.detectorConfigs.push({
      detector,
      weight,
      name: detectorName,
    });

    // Renormalize all weights
    const weightSum = this.detectorConfigs.reduce(
      (sum, config) => sum + config.weight,
      0
    );

    this.detectorConfigs.forEach(config => {
      config.weight = config.weight / weightSum;
    });

    logger.debug(
      `[CompositeIntentDetector] Added detector '${detectorName}' and renormalized weights:`,
      this.detectorConfigs.map(config => ({
        name: config.name,
        weight: config.weight.toFixed(3),
      }))
    );
  }
}
