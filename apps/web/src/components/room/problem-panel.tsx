import type { Problem } from "@leetcollab/contracts";
import { Search, Shuffle } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

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
  const difficultyVariant = problem?.difficulty === "Easy"
    ? "success"
    : problem?.difficulty === "Medium" ? "warning" : "destructive";

  return (
    <Card className="workspace-card problem-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Problem</p>
          <h1>{problem?.title ?? "Collaboration room"}</h1>
        </div>
        {problem && <Badge variant={difficultyVariant}>{problem.difficulty}</Badge>}
      </div>
      <div className="problem-meta">
        <span>{problem?.slug ?? "room"}</span>
        {problem?.category && <span>{problem.category}</span>}
        <span>{isHost ? "Host" : "Participant"}</span>
      </div>
      <div className="problem-controls" aria-label="Problem picker">
        <div className="filter-row" role="group" aria-label="Difficulty filter">
          {difficultyFilters.map((difficulty) => (
            <Button
              disabled={!canChangeProblem}
              key={difficulty}
              onClick={() => onDifficultyFilterChange(difficulty)}
              size="sm"
              variant={difficultyFilter === difficulty ? "default" : "outline"}
            >
              {difficulty}
            </Button>
          ))}
        </div>
        <div className="problem-picker-grid">
          <div className="search-field">
            <Search aria-hidden="true" />
            <Input
              aria-label="Search problems"
              disabled={!canChangeProblem}
              onChange={(event) => onSearchTermChange(event.target.value)}
              placeholder="Search problems..."
              type="search"
              value={searchTerm}
            />
          </div>
          <Select
            disabled={!canChangeProblem || pickerProblems.length === 0}
            onValueChange={onSelectProblem}
            value={problem?.id ?? ""}
          >
            <SelectTrigger aria-label="Selected problem">
              <SelectValue placeholder="No matching problems" />
            </SelectTrigger>
            <SelectContent>
              {pickerProblems.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.sortOrder}. {item.title} ({item.difficulty})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!canChangeProblem || problems.length === 0}
            onClick={onRandomProblem}
            variant="secondary"
          >
            <Shuffle aria-hidden="true" />
            Random
          </Button>
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
                <Card className="example-card" key={example.title}>
                  <strong>{example.title}</strong>
                  <pre>Input: {example.input}{'\n'}Output: {example.output}</pre>
                  {example.explanation && <p>{example.explanation}</p>}
                </Card>
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
    </Card>
  );
}
