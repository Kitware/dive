# Team Process

Our team process involves scrum-style practices with some key differences

* We don't have definite sprints.  Our backlog is fluid and re-evaludated every week.
* We don't story-point.  We should, but we aren't ready to do this yet.

## States

### `Untriaged`

> Technical contributors: We aren't sure if we should do this, how hard it will be, or if we have enough information.

`Untriaged` work may be necessary in the indefinite future, but has not been researched.  This is the requirements gathering state.

### `Backlog`

> Technical contributors: We know we can and should do this.  We aren't ready to do it yet.

`Backlog` work has been reviewed (asyncrhonously) by the whole team and deemed to be necessay and adequately understood.

### `Ready`

> Technical contributors: We should do this as soon as we have time.

`Ready` work has been reviewed synchronously by the whole team and accepted for immediate pickup.

### `Done`

> Technical contributors: We did this, and it's merged to main. Please verify that we met the criteria.

`Done` work has been completed by the technical team and requires review from team lead and stakeholders.

## Responsibilities

* Team leads and stakeholders
  * Can propose new work, which becomes `Untriaged`
  * Are solely responsible for maintaining priority in `Untriaged`.
  * Help technical team maintain priority in `Backlog`.

* Technical contributors
  * Can also propose new work, which can become `Backlog` or `Untriaged` depending on scope.
  * Are responsible for taking action on high-priority `Untriaged` work, moving it into the backlog.
  * Are responsible for gathering additional information or pushing back against `Untriaged` work.

## Meetings

Our team has a single weekly meeting. The goals of this meeting, in order of priority, are:

1. To verify the correctness of `Ready`
2. To verify the correctness of `Backlog`, and promote work to `Ready` if appropriate.
3. To review `Done` and verify that requirements have been met.

## Development

Install https://github.com/Kitware/ldc

```bash
# copy .env.example and make any changes
cp .env.example .env

# bring the server up
ldc up -d

# replace a pre-built image with the development version
# for example, here's how to work on the girder server code
ldc dev up girder
```

To work on the Vue client, see development instructions in `./client`.
