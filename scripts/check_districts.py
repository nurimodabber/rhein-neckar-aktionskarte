#!/usr/bin/env python3
"""
scripts/check_districts.py

Automated validation of all Stadtteil / district geometries:
- Coverage >= 99.0%
- Internal Overlap <= 0.5%
- External Area <= 0.5%
- Unique district IDs across the entire cluster
"""

import sys
import os
import json
import re
from shapely.geometry import shape
from shapely.ops import unary_union

def main():
    repo_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_path = os.path.join(repo_dir, 'rhein_neckar_data.js')
    districts_path = os.path.join(repo_dir, 'rhein_neckar_districts.js')

    with open(data_path, 'r', encoding='utf-8') as f:
        t_data = f.read()
    with open(districts_path, 'r', encoding='utf-8') as f:
        t_dist = f.read()

    m_data = re.search(r'const\s+RHEIN_NECKAR_GEOJSON\s*=\s*(\{.*\});?', t_data, re.DOTALL)
    m_dist = re.search(r'const\s+RHEIN_NECKAR_DISTRICTS\s*=\s*(\{.*\});?', t_dist, re.DOTALL)

    if not m_data or not m_dist:
        print("Error: Could not parse GeoJSON data files.")
        sys.exit(1)

    data_geo = json.loads(m_data.group(1))
    dist_geo = json.loads(m_dist.group(1))

    towns = {f['properties']['id']: f for f in data_geo['features']}
    dist_features = dist_geo['features']

    # 1. Unique IDs check
    district_ids = [f['properties']['id'] for f in dist_features]
    if len(district_ids) != len(set(district_ids)):
        print(f"Error: Duplicate district IDs found! Total: {len(district_ids)}, Unique: {len(set(district_ids))}")
        sys.exit(1)
    print(f"✓ All {len(district_ids)} district IDs are globally unique.")

    # 2. Geometric coverage, overlap and external area checks
    dist_by_town = {}
    for f in dist_features:
        dist_by_town.setdefault(f['properties']['townId'], []).append(f)

    failures = 0
    print(f"Auditing {len(dist_by_town)} subdivided municipalities...")
    for tid, dists in sorted(dist_by_town.items()):
        town = towns.get(tid)
        if not town:
            print(f"Error: District references unknown town ID: {tid}")
            failures += 1
            continue

        town_geom = shape(town['geometry']).buffer(0)
        d_shapes = [shape(d['geometry']).buffer(0) for d in dists]
        d_union = unary_union(d_shapes)

        town_area = town_geom.area
        cov = (town_geom.intersection(d_union).area / town_area) * 100
        ext = (d_union.difference(town_geom).area / town_area) * 100
        overlap_area = sum(d.area for d in d_shapes) - d_union.area
        overlap = (overlap_area / town_area) * 100
        t_name = town['properties']['name']

        if cov < 99.0 or overlap > 0.5 or ext > 0.5:
            print(f"✗ FAIL: {t_name} ({tid}): Cov={cov:.2f}% (>=99%), Overlap={overlap:.2f}% (<=0.5%), Ext={ext:.2f}% (<=0.5%)")
            failures += 1
        else:
            print(f"✓ PASS: {t_name:30} ({len(dists):2} Stadtteile) | Cov: {cov:6.2f}% | Overlap: {overlap:5.2f}% | Ext: {ext:5.2f}%")

    if failures > 0:
        print(f"\nAudit failed with {failures} error(s).")
        sys.exit(1)
    else:
        print(f"\nAll {len(dist_by_town)} subdivided municipalities passed quality checks! (162 Stadtteile total)")

if __name__ == '__main__':
    main()
