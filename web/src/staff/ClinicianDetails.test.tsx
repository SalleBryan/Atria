import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClinicianDetails } from "./ClinicianDetails";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
}));

const RECORDED = {
  staffId: "s-ekane",
  specialty: "General Practioner",
  registrationYear: 2015,
  ordreNumber: "CM-ONMC-7",
  languages: ["en"],
};

function show() {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(<ClinicianDetails staffId="s-ekane" name="Emmanuel Ekane" onClose={onClose} onDone={onDone} />);
  return { onDone, onClose };
}

describe("ClinicianDetails", () => {
  beforeEach(() => api.mockReset());

  it("sends only the corrected specialty", async () => {
    api.mockResolvedValueOnce(RECORDED).mockResolvedValueOnce({ ...RECORDED, specialty: "General Practitioner" });
    const { onDone } = show();
    const field = await screen.findByLabelText("Specialty");
    const user = userEvent.setup();
    await user.clear(field);
    await user.type(field, "General Practitioner");
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(api).toHaveBeenLastCalledWith("/admin/staff/s-ekane/clinician", {
      method: "PATCH",
      json: { specialty: "General Practitioner" },
    });
    expect(onDone).toHaveBeenCalledWith("Emmanuel Ekane's details are corrected.");
  });

  it("will not save an empty specialty", async () => {
    api.mockResolvedValueOnce(RECORDED);
    show();
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText("Specialty"));
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(screen.getByText("Enter their specialty.")).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("closes without a call when nothing changed", async () => {
    api.mockResolvedValueOnce(RECORDED);
    const { onClose } = show();
    await screen.findByLabelText("Specialty");
    await userEvent.setup().click(screen.getByRole("button", { name: "Save details" }));
    expect(onClose).toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(1);
  });
});
