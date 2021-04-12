# Use Cases

Why use DIVE?  What can it do?

---

## Discovering existing data

> Scenario: You want to find existing data to use.

There are two places to look.

* The [Training Data Collection](https://viame.kitware.com/#/collection/5e4c256ca0fc86aa03120c34) is organized rougly by domain and collection method.
* The [Stats Summary Page](https://viame.kitware.com/#/summary) lists every published dataset organized by object label.

---

## Sharing data

> Scenario: You want to upload some data and share it with others.

This use case is covered [on the sharing page](/Web-Version/#sharing-data-with-teams).

If you want to **publish** your data so that other groups can use it, please email <a href="mailto:viame-web@kitware.com">`viame-web@kitware.com`</a>.

---

## Running analysis workflows

> Scenario: You want to perform an automated analysis on your data.

In DIVE, these are called pipelines.  You'll need to see what sorts of analysis workflows are currently available [on the pipeline page](Pipeline-Documentation.md).

These sorts of artifical intelligence (AI) workflows are the final goal for most users.  They allow the user to quickly perform quantitative analysis to answer questions like **_how many individuals of each type appear on each image or video frame?_**

If no suitable existing analysis exists for your use case or you aren't sure how to proceed, you're welcome to email our team and ask for help at <a href="mailto:viame-web@kitware.com">`viame-web@kitware.com`</a>.

---

## Rapid model generation

> Scenario: You want to perform analysis (detection, tracking, measurement, etc) on object types not yet covered by the community data and pre-trained analysis pipelines available. **You want to train new models based on ground-truth annotations.**

---

## Iterative model refinement

> Scenario: You want to start with an OK model, or a model that doesn't perfectly fit your domain or use case, and make it better.

You should find out thorough experimentation whether or not annotation from scratch is faster or slower than running a sub-optimal analysis workflow and then doing manual "clean-up" on the results.  Either way, **the goal is to generate ground-truth annotations** and use them to create or improve a model.
