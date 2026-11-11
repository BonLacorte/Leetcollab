-- Original LeetCollab curriculum content and private Java fixture harnesses.
-- The exercises are authored for this project and do not reproduce source-judge statements.

-- Preserve legacy rows without exposing them or colliding with the new curriculum order.
update public.problems
set sort_order = sort_order + 1000,
    updated_at = now()
where slug in ('two-sum', 'valid-parentheses', 'reverse-linked-list', 'search-a-2d-matrix', 'jump-game')
  and sort_order < 1000;

insert into public.problems (
  slug, title, category, difficulty, sort_order, statement, starter_code,
  examples, constraints, is_enabled, supported_languages
)
values
  (
    'parcel-pair', 'Parcel Pair', 'Arrays', 'Easy', 1,
    'A dispatch shelf contains parcels with integer weights. Return the indices of two different parcels whose weights add to the truck capacity. Return an empty array when no pair fits. If several pairs fit, return the first pair encountered while scanning from left to right.',
    $java$class Solution {
  public static int[] findPair(int[] weights, int capacity) {
    // Return two indices, or an empty array.
    return new int[0];
  }
}$java$,
    '[{"title":"Small shelf","input":"weights = [4, 7, 1, 9], capacity = 10","output":"[2, 3]"},{"title":"No fit","input":"weights = [5, 6], capacity = 20","output":"[]"}]'::jsonb,
    array['0 <= weights.length <= 10000', 'Each index may be used at most once.'],
    true, array['java']::text[]
  ),
  (
    'bracket-beacon', 'Bracket Beacon', 'Stacks', 'Easy', 2,
    'A beacon message may contain round, square, and curly bracket markers. Return true when every opening marker is closed by the same marker type in properly nested order. Other characters do not appear.',
    $java$class Solution {
  public static boolean isBalanced(String signal) {
    return false;
  }
}$java$,
    '[{"title":"Nested signal","input":"signal = {[()]}","output":"true"},{"title":"Crossed signal","input":"signal = [(])","output":"false"}]'::jsonb,
    array['0 <= signal.length() <= 10000', 'signal contains only ()[]{}.'],
    true, array['java']::text[]
  ),
  (
    'checkpoint-reversal', 'Checkpoint Reversal', 'Arrays', 'Easy', 3,
    'A route is stored as checkpoint identifiers in travel order. Return a new array containing the same identifiers in reverse order. Do not modify the input array.',
    $java$class Solution {
  public static int[] reverse(int[] checkpoints) {
    return new int[0];
  }
}$java$,
    '[{"title":"Four stops","input":"checkpoints = [8, 3, 5, 1]","output":"[1, 5, 3, 8]"},{"title":"Empty route","input":"checkpoints = []","output":"[]"}]'::jsonb,
    array['0 <= checkpoints.length <= 10000'],
    true, array['java']::text[]
  ),
  (
    'first-ready-slot', 'First Ready Slot', 'Binary Search', 'Easy', 4,
    'A sorted array records readiness scores for appointment slots. Return the index of the first slot whose score is at least the requested score. Return -1 when no slot qualifies.',
    $java$class Solution {
  public static int firstAtLeast(int[] readiness, int target) {
    return -1;
  }
}$java$,
    '[{"title":"Middle match","input":"readiness = [2, 5, 5, 9], target = 5","output":"1"},{"title":"Above range","input":"readiness = [1, 3], target = 4","output":"-1"}]'::jsonb,
    array['readiness is sorted in nondecreasing order.', '0 <= readiness.length <= 100000'],
    true, array['java']::text[]
  ),
  (
    'relay-reachability', 'Relay Reachability', 'Greedy', 'Medium', 5,
    'Relay stations are arranged in a line. At station i, ranges[i] is the farthest number of stations a courier may advance. Return true when the courier can reach the final station from station 0.',
    $java$class Solution {
  public static boolean canReach(int[] ranges) {
    return false;
  }
}$java$,
    '[{"title":"Reachable","input":"ranges = [2, 2, 0, 1]","output":"true"},{"title":"Blocked","input":"ranges = [1, 0, 2]","output":"false"}]'::jsonb,
    array['1 <= ranges.length <= 100000', '0 <= ranges[i] <= 100000'],
    true, array['java']::text[]
  ),
  (
    'merge-maintenance-windows', 'Merge Maintenance Windows', 'Intervals', 'Medium', 6,
    'Each maintenance window is an inclusive [start, end] pair. Merge every overlapping or touching pair and return the resulting windows ordered by start time. The input order is arbitrary.',
    $java$class Solution {
  public static int[][] mergeWindows(int[][] windows) {
    return new int[0][0];
  }
}$java$,
    '[{"title":"Touching windows","input":"windows = [[8,10],[1,3],[3,6]]","output":"[[1, 6], [8, 10]]"},{"title":"Single window","input":"windows = [[4,9]]","output":"[[4, 9]]"}]'::jsonb,
    array['0 <= windows.length <= 10000', 'window start is not greater than its end.'],
    true, array['java']::text[]
  ),
  (
    'dominant-sensor-code', 'Dominant Sensor Code', 'Hash Maps', 'Easy', 7,
    'Return the sensor code that occurs most often in the readings. When several codes have the same highest frequency, return the smallest code. Return -1 for an empty reading list.',
    $java$class Solution {
  public static int mostFrequent(int[] readings) {
    return -1;
  }
}$java$,
    '[{"title":"Clear leader","input":"readings = [4, 2, 4, 3, 4, 2]","output":"4"},{"title":"Tie","input":"readings = [9, 3, 9, 3]","output":"3"}]'::jsonb,
    array['0 <= readings.length <= 100000'],
    true, array['java']::text[]
  ),
  (
    'target-segment-length', 'Target Segment Length', 'Sliding Window', 'Medium', 8,
    'All values in a stream are positive. Return the length of the shortest contiguous segment whose sum is at least target. Return 0 when no segment reaches target.',
    $java$class Solution {
  public static int shortestSegment(int[] values, int target) {
    return 0;
  }
}$java$,
    '[{"title":"Short interior segment","input":"values = [2, 1, 5, 2, 3], target = 7","output":"2"},{"title":"Unavailable","input":"values = [1, 1], target = 5","output":"0"}]'::jsonb,
    array['values[i] > 0', '1 <= target <= 1000000000'],
    true, array['java']::text[]
  ),
  (
    'elevation-gain', 'Elevation Gain', 'Arrays', 'Easy', 9,
    'A trail log lists elevations in visit order. Add only upward changes between consecutive readings and return the total climb. Downhill movement contributes zero.',
    $java$class Solution {
  public static int totalGain(int[] heights) {
    return 0;
  }
}$java$,
    '[{"title":"Rolling trail","input":"heights = [10, 13, 11, 18]","output":"10"},{"title":"Only downhill","input":"heights = [8, 5, 2]","output":"0"}]'::jsonb,
    array['0 <= heights.length <= 100000', 'The result fits in a signed 32-bit integer.'],
    true, array['java']::text[]
  ),
  (
    'signal-islands', 'Signal Islands', 'Graphs', 'Medium', 10,
    'A grid uses 1 for an active radio cell and 0 for silence. Count groups of active cells connected vertically or horizontally. Diagonal contact does not connect groups.',
    $java$class Solution {
  public static int countIslands(int[][] grid) {
    return 0;
  }
}$java$,
    '[{"title":"Three groups","input":"grid = [[1,1,0],[0,0,1],[1,0,1]]","output":"3"},{"title":"Silent grid","input":"grid = [[0,0]]","output":"0"}]'::jsonb,
    array['0 <= grid.length <= 300', 'Every cell is 0 or 1.'],
    true, array['java']::text[]
  ),
  (
    'dependency-order', 'Dependency Order', 'Graphs', 'Hard', 11,
    'Tasks are numbered from 0 to count - 1. Each pair [task, prerequisite] states that prerequisite must run first. Return the lexicographically smallest valid task order, or an empty array when the dependencies contain a cycle.',
    $java$class Solution {
  public static int[] buildOrder(int count, int[][] dependencies) {
    return new int[0];
  }
}$java$,
    '[{"title":"Forked plan","input":"count = 4, dependencies = [[2,0],[2,1],[3,1]]","output":"[0, 1, 2, 3]"},{"title":"Cycle","input":"count = 2, dependencies = [[0,1],[1,0]]","output":"[]"}]'::jsonb,
    array['0 <= count <= 10000', 'Task identifiers are within range.'],
    true, array['java']::text[]
  ),
  (
    'compact-runs', 'Compact Runs', 'Strings', 'Easy', 12,
    'Compress consecutive equal characters by writing the character followed by its run length. A count is always written, including 1. Return an empty string for empty input.',
    $java$class Solution {
  public static String compress(String input) {
    return "";
  }
}$java$,
    '[{"title":"Mixed runs","input":"input = aaabbc","output":"a3b2c1"},{"title":"Empty","input":"input = empty string","output":"empty string"}]'::jsonb,
    array['0 <= input.length() <= 100000', 'input contains lowercase English letters.'],
    true, array['java']::text[]
  ),
  (
    'mirrored-token', 'Mirrored Token', 'Strings', 'Easy', 13,
    'Return true when a token reads the same forward and backward after removing non-alphanumeric characters and ignoring letter case.',
    $java$class Solution {
  public static boolean isMirror(String token) {
    return false;
  }
}$java$,
    '[{"title":"Mirrored phrase","input":"token = Never odd, or even","output":"true"},{"title":"Different ends","input":"token = code review","output":"false"}]'::jsonb,
    array['0 <= token.length() <= 100000'],
    true, array['java']::text[]
  ),
  (
    'rotate-shift-queue', 'Rotate Shift Queue', 'Arrays', 'Medium', 14,
    'Return a new array formed by rotating values to the right by steps positions. steps may be larger than the array length. Return an empty array for empty input and do not modify the input.',
    $java$class Solution {
  public static int[] rotateRight(int[] values, int steps) {
    return new int[0];
  }
}$java$,
    '[{"title":"Wrapped shift","input":"values = [1,2,3,4,5], steps = 7","output":"[4, 5, 1, 2, 3]"},{"title":"Empty queue","input":"values = [], steps = 3","output":"[]"}]'::jsonb,
    array['0 <= values.length <= 100000', '0 <= steps <= 1000000000'],
    true, array['java']::text[]
  ),
  (
    'rolling-window-maximum', 'Rolling Window Maximum', 'Queues', 'Hard', 15,
    'For each contiguous window of width values in an integer stream, return its maximum. Return an empty array when width is not between 1 and the stream length.',
    $java$class Solution {
  public static int[] windowMax(int[] values, int width) {
    return new int[0];
  }
}$java$,
    '[{"title":"Moving peaks","input":"values = [1,3,-1,-3,5,3], width = 3","output":"[3, 3, 5, 5]"},{"title":"Invalid width","input":"values = [2,1], width = 0","output":"[]"}]'::jsonb,
    array['0 <= values.length <= 100000'],
    true, array['java']::text[]
  )
on conflict (slug) do update set
  title = excluded.title,
  category = excluded.category,
  difficulty = excluded.difficulty,
  sort_order = excluded.sort_order,
  statement = excluded.statement,
  starter_code = excluded.starter_code,
  examples = excluded.examples,
  constraints = excluded.constraints,
  is_enabled = excluded.is_enabled,
  supported_languages = excluded.supported_languages,
  updated_at = now();

insert into public.problem_judge_configs (
  problem_id, language, fixture_version, harness_source, expected_output
)
select p.id, 'java', 1, f.harness_source, f.expected_output
from public.problems p
join (
  values
    ('parcel-pair', $java$class Main {
  public static void main(String[] args) {
    System.out.println(java.util.Arrays.toString(Solution.findPair(new int[]{4,7,1,9}, 10)));
    System.out.println(java.util.Arrays.toString(Solution.findPair(new int[]{6,2,8}, 14)));
    System.out.println(java.util.Arrays.toString(Solution.findPair(new int[]{5,6}, 20)));
  }
}$java$, '["[2, 3]","[0, 2]","[]"]'::jsonb),
    ('bracket-beacon', $java$class Main {
  public static void main(String[] args) {
    System.out.println(Solution.isBalanced("{[()]}"));
    System.out.println(Solution.isBalanced("[(])"));
    System.out.println(Solution.isBalanced(""));
    System.out.println(Solution.isBalanced("(()"));
  }
}$java$, '["true","false","true","false"]'::jsonb),
    ('checkpoint-reversal', $java$class Main {
  static void check(int[] input) {
    int[] original = input.clone();
    int[] result = Solution.reverse(input);
    if (result == input || !java.util.Arrays.equals(input, original)) throw new IllegalStateException();
    System.out.println(java.util.Arrays.toString(result));
  }
  public static void main(String[] args) {
    check(new int[]{8,3,5,1});
    check(new int[]{});
    check(new int[]{7});
  }
}$java$, '["[1, 5, 3, 8]","[]","[7]"]'::jsonb),
    ('first-ready-slot', $java$class Main {
  public static void main(String[] args) {
    System.out.println(Solution.firstAtLeast(new int[]{2,5,5,9}, 5));
    System.out.println(Solution.firstAtLeast(new int[]{1,3}, 4));
    System.out.println(Solution.firstAtLeast(new int[]{4,4,4}, 1));
    System.out.println(Solution.firstAtLeast(new int[]{}, 2));
  }
}$java$, '["1","-1","0","-1"]'::jsonb),
    ('relay-reachability', $java$class Main {
  public static void main(String[] args) {
    System.out.println(Solution.canReach(new int[]{2,2,0,1}));
    System.out.println(Solution.canReach(new int[]{1,0,2}));
    System.out.println(Solution.canReach(new int[]{0}));
    System.out.println(Solution.canReach(new int[]{3,0,0,0}));
  }
}$java$, '["true","false","true","true"]'::jsonb),
    ('merge-maintenance-windows', $java$class Main {
  public static void main(String[] args) {
    System.out.println(java.util.Arrays.deepToString(Solution.mergeWindows(new int[][]{{8,10},{1,3},{3,6}})));
    System.out.println(java.util.Arrays.deepToString(Solution.mergeWindows(new int[][]{{4,9}})));
    System.out.println(java.util.Arrays.deepToString(Solution.mergeWindows(new int[][]{})));
    System.out.println(java.util.Arrays.deepToString(Solution.mergeWindows(new int[][]{{5,7},{1,2},{3,4}})));
  }
}$java$, '["[[1, 6], [8, 10]]","[[4, 9]]","[]","[[1, 2], [3, 4], [5, 7]]"]'::jsonb),
    ('dominant-sensor-code', $java$class Main {
  public static void main(String[] args) {
    System.out.println(Solution.mostFrequent(new int[]{4,2,4,3,4,2}));
    System.out.println(Solution.mostFrequent(new int[]{9,3,9,3}));
    System.out.println(Solution.mostFrequent(new int[]{}));
    System.out.println(Solution.mostFrequent(new int[]{-2,-2,-1,-1}));
  }
}$java$, '["4","3","-1","-2"]'::jsonb),
    ('target-segment-length', $java$class Main {
  public static void main(String[] args) {
    System.out.println(Solution.shortestSegment(new int[]{2,1,5,2,3}, 7));
    System.out.println(Solution.shortestSegment(new int[]{1,1}, 5));
    System.out.println(Solution.shortestSegment(new int[]{9}, 7));
    System.out.println(Solution.shortestSegment(new int[]{1,2,3,4}, 6));
  }
}$java$, '["2","0","1","2"]'::jsonb),
    ('elevation-gain', $java$class Main {
  public static void main(String[] args) {
    System.out.println(Solution.totalGain(new int[]{10,13,11,18}));
    System.out.println(Solution.totalGain(new int[]{8,5,2}));
    System.out.println(Solution.totalGain(new int[]{}));
    System.out.println(Solution.totalGain(new int[]{4,4,7}));
  }
}$java$, '["10","0","0","3"]'::jsonb),
    ('signal-islands', $java$class Main {
  public static void main(String[] args) {
    System.out.println(Solution.countIslands(new int[][]{{1,1,0},{0,0,1},{1,0,1}}));
    System.out.println(Solution.countIslands(new int[][]{{0,0}}));
    System.out.println(Solution.countIslands(new int[][]{}));
    System.out.println(Solution.countIslands(new int[][]{{1,0},{0,1}}));
  }
}$java$, '["3","0","0","2"]'::jsonb),
    ('dependency-order', $java$class Main {
  public static void main(String[] args) {
    System.out.println(java.util.Arrays.toString(Solution.buildOrder(4, new int[][]{{2,0},{2,1},{3,1}})));
    System.out.println(java.util.Arrays.toString(Solution.buildOrder(2, new int[][]{{0,1},{1,0}})));
    System.out.println(java.util.Arrays.toString(Solution.buildOrder(3, new int[][]{})));
    System.out.println(java.util.Arrays.toString(Solution.buildOrder(0, new int[][]{})));
  }
}$java$, '["[0, 1, 2, 3]","[]","[0, 1, 2]","[]"]'::jsonb),
    ('compact-runs', $java$class Main {
  public static void main(String[] args) {
    System.out.println(Solution.compress("aaabbc"));
    System.out.println(Solution.compress(""));
    System.out.println(Solution.compress("z"));
    System.out.println(Solution.compress("aabaaa"));
  }
}$java$, '["a3b2c1","","z1","a2b1a3"]'::jsonb),
    ('mirrored-token', $java$class Main {
  public static void main(String[] args) {
    System.out.println(Solution.isMirror("Never odd, or even"));
    System.out.println(Solution.isMirror("code review"));
    System.out.println(Solution.isMirror(""));
    System.out.println(Solution.isMirror("7-A-a-7"));
  }
}$java$, '["true","false","true","true"]'::jsonb),
    ('rotate-shift-queue', $java$class Main {
  static void check(int[] input, int k) {
    int[] original = input.clone();
    int[] result = Solution.rotateRight(input, k);
    if (result == input || !java.util.Arrays.equals(input, original)) throw new IllegalStateException();
    System.out.println(java.util.Arrays.toString(result));
  }
  public static void main(String[] args) {
    check(new int[]{1,2,3,4,5}, 7);
    check(new int[]{}, 3);
    check(new int[]{8,9}, 0);
    check(new int[]{1,2,3}, 3);
  }
}$java$, '["[4, 5, 1, 2, 3]","[]","[8, 9]","[1, 2, 3]"]'::jsonb),
    ('rolling-window-maximum', $java$class Main {
  public static void main(String[] args) {
    System.out.println(java.util.Arrays.toString(Solution.windowMax(new int[]{1,3,-1,-3,5,3}, 3)));
    System.out.println(java.util.Arrays.toString(Solution.windowMax(new int[]{2,1}, 0)));
    System.out.println(java.util.Arrays.toString(Solution.windowMax(new int[]{4,2}, 1)));
    System.out.println(java.util.Arrays.toString(Solution.windowMax(new int[]{7}, 2)));
  }
}$java$, '["[3, 3, 5, 5]","[]","[4, 2]","[]"]'::jsonb)
) as f(slug, harness_source, expected_output) on f.slug = p.slug
on conflict (problem_id) do update set
  language = excluded.language,
  fixture_version = excluded.fixture_version,
  harness_source = excluded.harness_source,
  expected_output = excluded.expected_output,
  updated_at = now();
