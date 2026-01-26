import { log } from './index.js';

interface PerformanceMetrics {
  ocrProcessingTimes: number[];
  databaseQueryTimes: number[];
  botResponseTimes: number[];
  errorCounts: Record<string, number>;
  requestCounts: Record<string, number>;
}

class MonitoringService {
  private metrics: PerformanceMetrics = {
    ocrProcessingTimes: [],
    databaseQueryTimes: [],
    botResponseTimes: [],
    errorCounts: {},
    requestCounts: {}
  };

  private readonly MAX_METRICS_HISTORY = 100;

  recordOCRProcessingTime(timeMs: number): void {
    this.metrics.ocrProcessingTimes.push(timeMs);
    if (this.metrics.ocrProcessingTimes.length > this.MAX_METRICS_HISTORY) {
      this.metrics.ocrProcessingTimes.shift();
    }
    
    if (timeMs > 30000) { // 30 seconds
      log(`⚠️ Slow OCR processing: ${timeMs}ms`, 'monitoring');
    }
  }

  recordDatabaseQueryTime(operation: string, timeMs: number): void {
    this.metrics.databaseQueryTimes.push(timeMs);
    if (this.metrics.databaseQueryTimes.length > this.MAX_METRICS_HISTORY) {
      this.metrics.databaseQueryTimes.shift();
    }
    
    if (timeMs > 1000) { // 1 second
      log(`⚠️ Slow database query (${operation}): ${timeMs}ms`, 'monitoring');
    }
  }

  recordBotResponseTime(command: string, timeMs: number): void {
    this.metrics.botResponseTimes.push(timeMs);
    if (this.metrics.botResponseTimes.length > this.MAX_METRICS_HISTORY) {
      this.metrics.botResponseTimes.shift();
    }
    
    if (timeMs > 5000) { // 5 seconds
      log(`⚠️ Slow bot response (${command}): ${timeMs}ms`, 'monitoring');
    }
  }

  recordError(errorType: string): void {
    this.metrics.errorCounts[errorType] = (this.metrics.errorCounts[errorType] || 0) + 1;
    log(`❌ Error recorded: ${errorType} (count: ${this.metrics.errorCounts[errorType]})`, 'monitoring');
  }

  recordRequest(endpoint: string): void {
    this.metrics.requestCounts[endpoint] = (this.metrics.requestCounts[endpoint] || 0) + 1;
  }

  getMetricsSummary(): string {
    const avgOCR = this.calculateAverage(this.metrics.ocrProcessingTimes);
    const avgDB = this.calculateAverage(this.metrics.databaseQueryTimes);
    const avgBot = this.calculateAverage(this.metrics.botResponseTimes);
    
    let summary = '📊 Performance Metrics Summary:\n';
    summary += `• Average OCR processing: ${avgOCR.toFixed(0)}ms\n`;
    summary += `• Average DB query time: ${avgDB.toFixed(0)}ms\n`;
    summary += `• Average bot response: ${avgBot.toFixed(0)}ms\n`;
    
    if (Object.keys(this.metrics.errorCounts).length > 0) {
      summary += '\n❌ Error Counts:\n';
      Object.entries(this.metrics.errorCounts).forEach(([type, count]) => {
        summary += `• ${type}: ${count}\n`;
      });
    }
    
    if (Object.keys(this.metrics.requestCounts).length > 0) {
      summary += '\n📈 Request Counts:\n';
      Object.entries(this.metrics.requestCounts).forEach(([endpoint, count]) => {
        summary += `• ${endpoint}: ${count}\n`;
      });
    }
    
    return summary;
  }

  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  }

  // Health check method
  getHealthStatus(): { status: 'healthy' | 'warning' | 'critical', details: string } {
    const avgOCR = this.calculateAverage(this.metrics.ocrProcessingTimes);
    const avgDB = this.calculateAverage(this.metrics.databaseQueryTimes);
    const totalErrors = Object.values(this.metrics.errorCounts).reduce((sum, count) => sum + count, 0);
    
    if (avgOCR > 45000 || avgDB > 2000 || totalErrors > 50) {
      return {
        status: 'critical',
        details: `High latency or error rate detected. OCR: ${avgOCR.toFixed(0)}ms, DB: ${avgDB.toFixed(0)}ms, Errors: ${totalErrors}`
      };
    }
    
    if (avgOCR > 30000 || avgDB > 1000 || totalErrors > 20) {
      return {
        status: 'warning',
        details: `Performance degradation detected. OCR: ${avgOCR.toFixed(0)}ms, DB: ${avgDB.toFixed(0)}ms, Errors: ${totalErrors}`
      };
    }
    
    return {
      status: 'healthy',
      details: 'All systems operating normally'
    };
  }

  // Reset metrics (useful for periodic cleanup)
  resetMetrics(): void {
    this.metrics = {
      ocrProcessingTimes: [],
      databaseQueryTimes: [],
      botResponseTimes: [],
      errorCounts: {},
      requestCounts: {}
    };
    log('📊 Metrics reset', 'monitoring');
  }
}

export const monitoring = new MonitoringService();

// Performance measurement decorators
export function measureOCRTime<T extends any[], R>(
  target: any,
  propertyName: string,
  descriptor: TypedPropertyDescriptor<(...args: T) => Promise<R>>
) {
  const method = descriptor.value!;
  descriptor.value = async function (...args: T): Promise<R> {
    const start = Date.now();
    try {
      const result = await method.apply(this, args);
      monitoring.recordOCRProcessingTime(Date.now() - start);
      return result;
    } catch (error) {
      monitoring.recordError('ocr_processing');
      throw error;
    }
  };
}

export function measureDBTime(operation: string) {
  return function <T extends any[], R>(
    target: any,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<(...args: T) => Promise<R>>
  ) {
    const method = descriptor.value!;
    descriptor.value = async function (...args: T): Promise<R> {
      const start = Date.now();
      try {
        const result = await method.apply(this, args);
        monitoring.recordDatabaseQueryTime(operation, Date.now() - start);
        return result;
      } catch (error) {
        monitoring.recordError(`db_${operation}`);
        throw error;
      }
    };
  };
}

// Log metrics summary every 10 minutes
setInterval(() => {
  const health = monitoring.getHealthStatus();
  log(`Health Status: ${health.status} - ${health.details}`, 'monitoring');
  
  if (health.status !== 'healthy') {
    log(monitoring.getMetricsSummary(), 'monitoring');
  }
}, 10 * 60 * 1000);