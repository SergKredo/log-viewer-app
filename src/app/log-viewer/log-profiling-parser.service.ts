import { Injectable } from '@angular/core';

export interface ProfilingRecord {
  timestamp: string;          // raw timestamp string
  responseId: string;         // GUID
  workspaceId?: string;       // GUID or undefined
  route?: string;             // /api/data
  method?: string;            // POST
  durationMs?: number;        // from middleware (Time request-response)
  wallMs?: number;            // wall time (wall_s * 1000)
  coreMs?: number;            // core time (core_s * 1000)
  waitMs?: number;            // wall - core
  waitRatio?: number;         // waitMs / durationMs
}

export interface ProfilingAggregates {
  count: number;
  avg: number;
  p50: number; p90: number; p95: number; p99: number;
  min: number; max: number; stdDev: number;
  slowCount: number; slowPercent: number; // using threshold
  coreShare: number; // sum(core)/sum(wall)
}

export interface ProfileNode {
  name: string;
  count?: number;
  wallMs?: number; // inclusive
  coreMs?: number;
  selfWallMs?: number; // wall - sum(children.wall)
  annotations?: string[];
  children: ProfileNode[];
  depth: number;
}

@Injectable({ providedIn: 'root' })
export class LogProfilingParserService {
  private rxMiddlewareHeader = /\[(?<ts>[^\]]+)] \[WebScape\.Server\.Services\.Middlewares\.RequestResponseLoggingMiddleware].*?(?:\[(?<ws>[0-9a-fA-F-]{36})])?$/;
  private rxResponseId = /Begin Http Response Information: Response ID:(?<id>[0-9a-fA-F-]{36})/;
  private rxDuration = /Time request-response:\s+(?<dur>\d+)\s+ms/;
  private rxProfileLineHeader = /\[WebScape\.Common\.Profiling\.ProfileService].*?\[(?<resp>[0-9a-fA-F-]{36})] \[(?<ws>[0-9a-fA-F-]{36})]/;
  private rxExecLine = /-\s+(?<route>\/[\S]*)\s+(?<method>GET|POST|PUT|DELETE|PATCH)\s+\d+\s+(?<wall>\d+\.\d+)\s*\/\s*(?<core>\d+\.\d+)/;

  // Storage for hierarchical trees keyed by responseId
  private profileTrees = new Map<string, ProfileNode>();

  parseGroupedLogs(groups: string[]): ProfilingRecord[] {
    const middlewareMap = new Map<string, Partial<ProfilingRecord>>();
    const profileMap = new Map<string, Partial<ProfilingRecord>>();

    for (const group of groups) {
      const lines = group.split(/\n/);
      for (const line of lines) {
        if (line.includes('RequestResponseLoggingMiddleware')) {
          const h = this.rxMiddlewareHeader.exec(line);
          if (h?.groups) {
            const ws = h.groups['ws'];
            const ts = h.groups['ts'];
            // response id & duration may appear in later lines
            // initialize placeholder
            // We'll fill once we have ID.
          }
        }
        const respMatch = this.rxResponseId.exec(line);
        if (respMatch?.groups) {
          const id = respMatch.groups['id'];
          let rec = middlewareMap.get(id);
          if (!rec) rec = { responseId: id };
          // find timestamp & workspace from earlier header line within same group
          // naive: search header line again inside group
          if (!rec.timestamp) {
            const headerLine = lines.find(l => l.includes('RequestResponseLoggingMiddleware'));
            if (headerLine) {
              const h = this.rxMiddlewareHeader.exec(headerLine);
              if (h?.groups) {
                rec.timestamp = h.groups['ts'];
                rec.workspaceId = h.groups['ws'];
              }
            }
          }
          const durMatch = this.rxDuration.exec(group);
          if (durMatch?.groups) {
            rec.durationMs = parseInt(durMatch.groups['dur'], 10);
          }
          middlewareMap.set(id, rec);
        }
        if (line.includes('Profiling.ProfileService')) {
          const ph = this.rxProfileLineHeader.exec(line);
          if (ph?.groups) {
            const resp = ph.groups['resp'];
            let rec = profileMap.get(resp);
            if (!rec) rec = { responseId: resp };
            rec.workspaceId = rec.workspaceId || ph.groups['ws'];
            // execution line might be in subsequent line(s)
          }
        }
      }
      // execution profile line may be in group lines starting with '- '
      for (const line2 of lines) {
        if (line2.startsWith('- /')) {
          const ex = this.rxExecLine.exec(line2);
            if (ex?.groups) {
              // Need associated response id from header; search a profile header line in this group
              const header = lines.find(l => l.includes('Profiling.ProfileService'));
              if (header) {
                const ph = this.rxProfileLineHeader.exec(header);
                const resp = ph?.groups?.['resp'];
                if (resp) {
                  let rec = profileMap.get(resp);
                  if (!rec) rec = { responseId: resp };
                  rec.route = ex.groups['route'];
                  rec.method = ex.groups['method'];
                  const wall = parseFloat(ex.groups['wall']);
                  const core = parseFloat(ex.groups['core']);
                  rec.wallMs = wall * 1000;
                  rec.coreMs = core * 1000;
                  rec.waitMs = (rec.wallMs ?? 0) - (rec.coreMs ?? 0);
                  profileMap.set(resp, rec);
                }
              }
            }
        }
      }

      // Build hierarchical tree if this group contains an Execution profile header line
      if (lines.some(l => l.trim() === 'Execution profile:')) {
        const header = lines.find(l => l.includes('Profiling.ProfileService'));
        if (header) {
          const ph = this.rxProfileLineHeader.exec(header);
          const resp = ph?.groups?.['resp'];
          if (resp) {
            const tree = this.buildProfileTree(lines);
            if (tree) this.profileTrees.set(resp, tree);
          }
        }
      }
    }

    // merge maps
    const result: ProfilingRecord[] = [];
    const ids = new Set([...middlewareMap.keys(), ...profileMap.keys()]);
    ids.forEach(id => {
      const mid = middlewareMap.get(id) || {}; const prof = profileMap.get(id) || {};
      const durationMs = mid.durationMs ?? prof.wallMs; // fallback
      const wallMs = prof.wallMs; const coreMs = prof.coreMs;
      const rec: ProfilingRecord = {
        timestamp: (mid.timestamp || ''),
        responseId: id,
        workspaceId: mid.workspaceId || prof.workspaceId,
        route: prof.route,
        method: prof.method,
        durationMs: durationMs,
        wallMs: wallMs,
        coreMs: coreMs,
        waitMs: (wallMs != null && coreMs != null) ? (wallMs - coreMs) : undefined,
        waitRatio: (durationMs && wallMs && coreMs != null) ? (((wallMs - coreMs) / durationMs)) : undefined
      };
      result.push(rec);
    });

    return result;
  }

  private buildProfileTree(lines: string[]): ProfileNode | null {
    const execIndex = lines.findIndex(l => l.trim() === 'Execution profile:');
    if (execIndex === -1) return null;
    const nodeLines: string[] = [];
    for (let i = execIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue; // skip empty
      // stop if we reach next timestamp-like line
      if (/^\[\d{4}-\d{2}-\d{2} /.test(line)) break;
      if (/^\s*[->]/.test(line)) nodeLines.push(line);
      else if (line.startsWith('End Http Response')) break;
    }
    if (!nodeLines.length) return null;
    const stack: ProfileNode[] = [];
    let root: ProfileNode | null = null;
    for (const raw of nodeLines) {
      const annotationMatch = raw.match(/^(\s*)>\s(.+)/);
      if (annotationMatch) {
        const depthSpace = annotationMatch[1].length;
        // find closest node with depth <= depthSpace
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].depth <= depthSpace) {
            if (!stack[i].annotations) {
              stack[i].annotations = [];
            }
            stack[i].annotations!.push(annotationMatch[2]);
            break;
          }
        }
        continue;
      }
      const nodeMatch = raw.match(/^(\s*)-\s(.+)$/);
      if (!nodeMatch) continue;
      const indent = nodeMatch[1];
      const depth = indent.length; // raw spaces count, relative
      const content = nodeMatch[2];
      // Split by tabs (fallback to multiple spaces)
      const parts = content.split(/\t+/).map(p => p.trim()).filter(p=>p.length);
      const name = parts[0];
      let count: number | undefined; let wallMs: number | undefined; let coreMs: number | undefined;
      if (parts.length >= 2) {
        const maybeCount = parseInt(parts[1], 10);
        if (!isNaN(maybeCount)) count = maybeCount;
      }
      if (parts.length >= 3) {
        // parts[2] may contain either number OR number / number
        const timePart = parts[2];
        const dual = timePart.match(/(\d+\.\d+)\s*\/\s*(\d+\.\d+)/);
        if (dual) {
          wallMs = parseFloat(dual[1]) * 1000;
          coreMs = parseFloat(dual[2]) * 1000;
        } else {
          const single = timePart.match(/(\d+\.\d+)/);
          if (single) wallMs = parseFloat(single[1]) * 1000;
        }
      }
      // Sometimes timings appear in separate columns (e.g., 0.042 / 0.006 as parts[2] & parts[3])
      if (parts.length >= 4 && wallMs == null) {
        const maybeWall = parts[2].match(/\d+\.\d+/); const maybeCore = parts[3].match(/\d+\.\d+/);
        if (maybeWall) wallMs = parseFloat(maybeWall[0]) * 1000;
        if (maybeCore) coreMs = parseFloat(maybeCore[0]) * 1000;
      }
      const node: ProfileNode = { name, count, wallMs, coreMs, children: [], depth };
      // attach to parent based on depth
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      if (stack.length === 0) {
        root = node;
      } else {
        stack[stack.length - 1].children.push(node);
      }
      stack.push(node);
    }
    if (root) this.computeSelfTimes(root);
    return root;
  }

  private computeSelfTimes(node: ProfileNode): number { // returns total wall of node
    const childrenWall = node.children.reduce((a,c)=> a + this.computeSelfTimes(c), 0);
    const wall = node.wallMs ?? 0;
    node.selfWallMs = wall - childrenWall;
    return wall;
  }

  getProfileTree(responseId: string): ProfileNode | undefined {
    return this.profileTrees.get(responseId);
  }

  getProfileTrees(): Map<string, ProfileNode> {
    return this.profileTrees;
  }

  computeAggregates(records: ProfilingRecord[], slowThresholdMs = 100): ProfilingAggregates {
    if (records.length === 0) {
      return { count:0, avg:0, p50:0, p90:0, p95:0, p99:0, min:0, max:0, stdDev:0, slowCount:0, slowPercent:0, coreShare:0 };
    }
    const values = records.map(r => r.durationMs || 0).sort((a,b)=>a-b);
    const sum = values.reduce((a,b)=>a+b,0);
    const avg = sum / values.length;
    const percentile = (p:number)=>{ if(values.length===0) return 0; const idx = (p/100)*(values.length-1); const lo=Math.floor(idx); const hi=Math.ceil(idx); if(lo===hi) return values[lo]; const w=idx-lo; return values[lo]*(1-w)+values[hi]*w; };
    const slowValues = values.filter(v=>v>slowThresholdMs);
    const min = values[0]; const max = values[values.length-1];
    const variance = values.reduce((a,v)=>a + Math.pow(v-avg,2),0)/values.length;
    const stdDev = Math.sqrt(variance);
    const wallSum = records.reduce((a,r)=> a + (r.wallMs || 0),0);
    const coreSum = records.reduce((a,r)=> a + (r.coreMs || 0),0);
    return {
      count: values.length,
      avg: avg,
      p50: percentile(50),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
      min, max, stdDev,
      slowCount: slowValues.length,
      slowPercent: (slowValues.length/values.length)*100,
      coreShare: wallSum? (coreSum / wallSum): 0
    };
  }
}
