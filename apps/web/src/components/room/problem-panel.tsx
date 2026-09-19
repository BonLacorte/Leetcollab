import type { Problem } from "@leetcollab/contracts";

export type DifficultyFilter = "All" | Problem["difficulty"];

type ProblemPanelProps = {
  problem: Problem | null;
  isHost: boolean;
  problems: Problem[];
  filteredProblems: Problem[];
  canChangeProblem: boolean;
  difficultyFilter: DifficultyFilter;
  searchTerm: string;
  onDifficultyFilterChange: (difficulty: DifficultyFilter) => void;
  onSearchTermChange: (searchTerm: string) => void;
  onSelectProblem: (problemId: string) => void;
  onRandomProblem: () => void;
};

const difficultyFilters: DifficultyFilter[] = ["All", "Easy", "Medium", "Hard"];

export function ProblemPanel({
  problem,
  isHost,
  problems,
  filteredProblems,
  canChangeProblem,
  difficultyFilter,
  searchTerm,
  onDifficultyFilterChange,
  onSearchTermChange,
  onSelectProblem,
  onRandomProblem,
}: ProblemPanelProps) {
  const pickerProblems = problem && !filteredProblems.some((item) => item.id === problem.id)
    ? [problem, ...filteredProblems]
    : filteredProblems;

  return (
    <article className="workspace-card problem-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Problem</p>
          <h1>{problem?.title ?? "Collaboration room"}</h1>
        </div>
        {problem && <span className={`difficulty difficulty-${problem.difficulty.toLowerCase()}`}>{problem.difficulty}</span>}
      </div>
      <div className="problem-meta">
        <span>{problem?.slug ?? "room"}</span>
        {problem?.category && <span>{problem.category}</span>}
        <span>{isHost ? "Host" : "Participant"}</span>
      </div>
      <div className="problem-controls" aria-label="Problem picker">
        <div className="filter-row" role="group" aria-label="Difficulty filter">
          {difficultyFilters.map((difficulty) => (
            <button
              className={difficultyFilter === difficulty ? "filter-chip active" : "filter-chip"}
              disabled={!canChangeProblem}
              key={difficulty}
              onClick={() => onDifficultyFilterChange(difficulty)}
              type="button"
            >
              {difficulty}
            </button>
          ))}
        </div>
        <div className="problem-picker-grid">
          <input
            disabled={!canChangeProblem}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Search problems..."
            type="search"
            value={searchTerm}
          />
          <select
            disabled={!canChangeProblem || pickerProblems.length === 0}
            onChange={(event) => onSelectProblem(event.target.value)}
            value={problem?.id ?? ""}
          >
            {pickerProblems.length === 0 && <option value="">No matching problems</option>}
            {pickerProblems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sortOrder}. {item.title} ({item.difficulty})
              </option>
            ))}
          </select>
          <button
            className="secondary"
            disabled={!canChangeProblem || problems.length === 0}
            onClick={onRandomProblem}
            type="button"
          >
            Random
          </button>
        </div>
        {!canChangeProblem && <p className="muted">You can view the selected problem, but changing it requires permission.</p>}
      </div>
      <div className="problem-copy">
        {problem ? <>
          <p>{problem.statement}</p>
          {problem.examples.length > 0 && <>
            <h2>Examples</h2>
            <div className="example-list">
              {problem.examples.map((example) => (
                <div className="example-card" key={example.title}>
                  <strong>{example.title}</strong>
                  <pre>Input: {example.input}{'\n'}Output: {example.output}</pre>
                  {example.explanation && <p>{example.explanation}</p>}
                </div>
              ))}
            </div>
          </>}
          {problem.constraints.length > 0 && <>
            <h2>Constraints</h2>
            <ul className="constraint-list">
              {problem.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}
            </ul>
          </>}
        </> : <p>Waiting for a problem to be selected.</p>}
      </div>
    </article>
  );
}
